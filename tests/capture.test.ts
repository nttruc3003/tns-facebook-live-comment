import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createApp } from '../server/app.js';
import { openStore, seedDemo, streams } from '../server/store.js';
import { videoUrl, profileIdentity, facebookAvatarUrl } from '../server/capture.js';
import { evaluate, commentsCsv } from '../server/games.js';
import { defaultFilter, sanitizeBrowserComment, type Comment } from '../shared/types.js';
import { api, setCsrf } from '../src/api.js';

test('Browser capture: stable session codes, scoped ingestion, rotation, restart and revocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-capture-test-'));
  let { app, db } = await createApp({ directory, setupToken: 'setup-test', collector: false });
  const origin = { host: 'localhost:3210', origin: 'http://localhost:3210' };
  const extId = 'a'.repeat(32),
    ext = { host: 'localhost:3210', origin: `chrome-extension://${extId}` };
  try {
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: origin,
      payload: {
        username: 'admin',
        name: 'Admin',
        password: 'test-password-123',
        setupToken: 'setup-test',
      },
    });
    assert.equal(setup.statusCode, 200, setup.body);
    const admin = {
      ...origin,
      cookie: setup.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': setup.json().csrf,
    };
    const issue = (video = '123') =>
      app.inject({
        method: 'POST',
        url: '/api/capture/pair-code',
        headers: admin,
        payload: { url: `https://www.facebook.com/watch/?v=${video}`, title: `Session ${video}` },
      });
    const code = (await issue()).json().code;
    const pairBody = { code, extensionId: extId, name: 'Test browser' };
    const pair = (headers = ext, remoteAddress = '127.0.0.1') =>
      app.inject({
        method: 'POST',
        url: '/api/capture/bridge/pair',
        headers,
        remoteAddress,
        payload: pairBody,
      });
    assert.equal((await pair({ ...ext, origin: 'https://evil.example' })).statusCode, 403);
    assert.equal((await pair(ext, '192.168.1.8')).statusCode, 403);
    assert.equal(
      (await app.inject({ method: 'OPTIONS', url: '/api/capture/bridge/pair', headers: ext }))
        .statusCode,
      204,
    );
    const paired = await pair();
    assert.equal(paired.statusCode, 200, paired.body);
    assert.equal(paired.json().session.videoId, '123');
    assert.equal(paired.json().session.title, 'Session 123');
    assert.equal((await issue()).json().code, code);
    const headers = { ...ext, authorization: `Bearer ${paired.json().credential}` };
    const storedCode = db.prepare('SELECT * FROM capture_pairings').get() as any;
    assert.notEqual(storedCode.encryptedCode, code);
    assert.ok(!JSON.stringify(storedCode).includes(code));
    const listing = await app.inject({ method: 'GET', url: '/api/capture', headers: admin });
    assert.ok(!listing.body.includes(code));
    assert.equal(listing.json().sessions.length, 1);
    assert.equal(listing.json().sessions[0].onlineDeviceCount, 1);
    assert.equal(listing.json().devices[0].connected, 1);
    // A different operator may not read or rotate this session's secret.
    const operator = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: admin,
      payload: {
        username: 'operator',
        name: 'Operator',
        password: 'test-password-123',
        role: 'operator',
      },
    });
    assert.equal(operator.statusCode, 200, operator.body);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: origin,
      payload: { username: 'operator', password: 'test-password-123' },
    });
    const operatorHeaders = {
      ...origin,
      cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': login.json().csrf,
    };
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/capture/pair-code',
          headers: operatorHeaders,
          payload: { url: 'https://www.facebook.com/watch/?v=123' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/capture/sessions/${storedCode.streamId}/rotate`,
          headers: operatorHeaders,
          payload: {},
        })
      ).statusCode,
      403,
    );
    const rotated = await app.inject({
      method: 'POST',
      url: '/api/capture/bridge/pair',
      headers: ext,
      payload: {
        ...pairBody,
        code: (await issue()).json().code,
        previousCredential: paired.json().credential,
      },
    });
    assert.equal(rotated.statusCode, 200, rotated.body);
    assert.equal(rotated.json().deviceId, paired.json().deviceId);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/capture/bridge/status',
          headers,
          payload: {},
        })
      ).statusCode,
      401,
    );
    headers.authorization = `Bearer ${rotated.json().credential}`;
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/capture', headers: admin })).json().devices
        .length,
      1,
    );
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/streams', headers })).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/capture/bridge/start',
          headers: { ...headers, origin: `chrome-extension://${'b'.repeat(32)}` },
          payload: { url: 'https://www.facebook.com/watch/?v=123', title: 'Test' },
        })
      ).statusCode,
      403,
    );
    const started = await app.inject({
      method: 'POST',
      url: '/api/capture/bridge/start',
      headers,
      payload: { url: 'https://www.facebook.com/watch/?v=123', title: 'Test live' },
    });
    assert.equal(started.statusCode, 200, started.body);
    const { captureId, streamId } = started.json();
    const verified = await app.inject({
      method: 'POST',
      url: '/api/capture/bridge/pair',
      headers: ext,
      payload: {
        ...pairBody,
        previousCredential: rotated.json().credential,
        verifyOnly: true,
      },
    });
    assert.equal(verified.statusCode, 200, verified.body);
    assert.equal(verified.json().alreadyPaired, true);
    assert.equal(verified.json().credential, undefined);
    assert.equal(verified.json().session.streamId, streamId);
    const observedAt = Date.now();
    const row = (
      id: string,
      authorUrl: string | null,
      message = '5',
      avatarUrl: string | null = null,
    ) => ({
      id,
      authorName: 'Same display name',
      authorUrl,
      avatarUrl,
      message,
      observedAt,
      parentId: null,
    });
    const comments = [
      row('fb:1', 'https://www.facebook.com/host', 'Bắt Đầu'),
      row(
        'fb:2',
        'https://www.facebook.com/one',
        '5',
        'https://scontent-lax3-1.xx.fbcdn.net/avatar.jpg?token=example',
      ),
      row('fb:3', 'https://www.facebook.com/two', '5', 'https://evil.example/avatar.jpg'),
      row('fb:4', null),
      row('fb:5', 'https://www.facebook.com/host', 'Kết Thúc'),
    ];
    const payload = { captureId, url: 'https://www.facebook.com/watch/?v=123', comments };
    const batch = (body: any = payload) =>
      app.inject({ method: 'POST', url: '/api/capture/bridge/batch', headers, payload: body });
    assert.equal(
      (await batch({ ...payload, url: 'https://www.facebook.com/watch/?v=999' })).statusCode,
      409,
    );
    assert.equal(
      (
        await batch({
          ...payload,
          comments: [{ ...comments[0], observedAt: Date.now() + 86400000 }],
        })
      ).statusCode,
      400,
    );
    const first = await batch();
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().inserted, 5);
    assert.equal((await batch()).json().inserted, 0);
    const stored = db
      .prepare('SELECT * FROM comments WHERE streamId=? ORDER BY seq')
      .all(streamId) as Comment[];
    assert.equal(stored.length, 5);
    assert.equal(stored[0].timeBasis, 'observed');
    assert.equal(stored[0].identityBasis, 'profile-url');
    assert.equal(stored[3].authorId, null);
    assert.match(stored[1].avatarUrl!, /fbcdn\.net/);
    assert.equal(stored[2].avatarUrl, null);
    const commentRange = await app.inject({
      method: 'GET',
      url: `/api/streams/${streamId}/comments/range?start=fb%3A1&end=fb%3A5`,
      headers: admin,
    });
    assert.deepEqual(
      commentRange.json().map((comment: Comment) => comment.id),
      ['fb:2', 'fb:3', 'fb:4'],
    );
    const numberSaved = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/comment-numbers`,
      headers: admin,
      payload: {
        items: [
          { commentId: 'fb:2', firstNumber: '15', secondNumber: '27' },
          { commentId: 'fb:3', firstNumber: '5', secondNumber: '' },
        ],
      },
    });
    assert.equal(numberSaved.statusCode, 200, numberSaved.body);
    const savedNumbers = db
      .prepare('SELECT firstNumber,secondNumber FROM comments WHERE streamId=? AND id=?')
      .get(streamId, 'fb:2') as Comment;
    assert.equal(savedNumbers.firstNumber, '15');
    assert.equal(savedNumbers.secondNumber, '27');
    const rejectedBatch = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/comment-numbers`,
      headers: admin,
      payload: {
        items: [
          { commentId: 'fb:2', firstNumber: '99', secondNumber: '88' },
          { commentId: 'missing', firstNumber: '1', secondNumber: '2' },
        ],
      },
    });
    assert.equal(rejectedBatch.statusCode, 404, rejectedBatch.body);
    assert.equal(
      (
        db
          .prepare('SELECT firstNumber FROM comments WHERE streamId=? AND id=?')
          .get(streamId, 'fb:2') as Comment
      ).firstNumber,
      '15',
    );
    const rangeWithNumber = await app.inject({
      method: 'GET',
      url: `/api/streams/${streamId}/comments/range?start=fb%3A1&end=fb%3A5`,
      headers: admin,
    });
    assert.equal(
      rangeWithNumber.json().find((comment: Comment) => comment.id === 'fb:2').firstNumber,
      '15',
    );
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: `/api/streams/${streamId}/comments/range?start=fb%3A5&end=fb%3A1`,
          headers: admin,
        })
      ).statusCode,
      400,
    );
    const avatarBackfill = await batch({
      ...payload,
      comments: [
        row(
          'fb:3',
          'https://www.facebook.com/two',
          '5',
          'https://scontent-lax3-1.xx.fbcdn.net/avatar-new.jpg?token=example',
        ),
      ],
    });
    assert.equal(avatarBackfill.json().inserted, 1);
    assert.match(
      (
        db
          .prepare('SELECT avatarUrl FROM comments WHERE streamId=? AND id=?')
          .get(streamId, 'fb:3') as Comment
      ).avatarUrl!,
      /avatar-new/,
    );
    const result = evaluate(
      db,
      streamId,
      { ...defaultFilter, startCommentId: 'fb:1', endCommentId: 'fb:5' },
      'Admin',
      'Round',
    );
    assert.equal(result.count, 2);
    assert.equal(result.commentCount, 3);
    assert.equal(result.unknownAuthors, 1);
    assert.equal(result.provisional, true);
    assert.match(result.warning!, /thứ tự ghi nhận/);
    assert.match(commentsCsv(stored), /observed/);
    // Switching videos cannot route an old batch into the new video's history.
    const wrongVideo = await app.inject({
      method: 'POST',
      url: '/api/capture/bridge/start',
      headers,
      payload: { url: 'https://www.facebook.com/watch/?v=456', title: 'Wrong video' },
    });
    assert.equal(wrongVideo.statusCode, 403);
    const code2 = (await issue('456')).json().code;
    assert.notEqual(code2, code);
    const paired2 = await app.inject({
      method: 'POST',
      url: '/api/capture/bridge/pair',
      headers: ext,
      payload: { ...pairBody, code: code2 },
    });
    const headers2 = { ...ext, authorization: `Bearer ${paired2.json().credential}` };
    const second = await app.inject({
      method: 'POST',
      url: '/api/capture/bridge/start',
      headers: headers2,
      payload: { url: 'https://www.facebook.com/watch/?v=456', title: 'Second video' },
    });
    assert.equal(second.statusCode, 200, second.body);
    assert.notEqual(second.json().streamId, streamId);
    assert.equal((await batch()).statusCode, 200);
    assert.equal((await batch({ ...payload, captureId: second.json().captureId })).statusCode, 409);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/capture/bridge/batch',
          headers: headers2,
          payload: {
            ...payload,
            captureId: second.json().captureId,
            url: 'https://www.facebook.com/watch/?v=456',
          },
        })
      ).json().inserted,
      5,
    );
    assert.equal(
      (db.prepare('SELECT count(*) AS n FROM comments WHERE streamId=?').get(streamId) as any).n,
      5,
    );
    const resume = await app.inject({
      method: 'POST',
      url: '/api/capture/bridge/start',
      headers,
      payload: { url: 'https://www.facebook.com/watch/?v=123', title: 'Resume first video' },
    });
    assert.equal(resume.json().streamId, streamId);
    assert.notEqual(resume.json().captureId, captureId);
    payload.captureId = resume.json().captureId;
    assert.equal((await batch()).json().inserted, 0);
    const stopped = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/collect`,
      headers: admin,
      payload: { enabled: false },
    });
    assert.equal(stopped.statusCode, 200);
    assert.equal((await batch()).statusCode, 409);
    const devices = await app.inject({ method: 'GET', url: '/api/capture', headers: admin });
    assert.ok(!devices.body.includes(paired.json().credential));
    const device = devices.json().devices.find((d: any) => d.id === rotated.json().deviceId);
    // Exercise the actual browser API helper: no Content-Type on a bodyless DELETE.
    const originalFetch = globalThis.fetch;
    setCsrf(setup.json().csrf);
    globalThis.fetch = async (input, init) => {
      const requestHeaders = Object.fromEntries(new Headers(init?.headers));
      assert.equal(requestHeaders['content-type'], undefined);
      const response = await app.inject({
        method: 'DELETE',
        url: String(input),
        headers: { ...admin, ...requestHeaders },
      });
      return new Response(response.body, { status: response.statusCode });
    };
    try {
      assert.deepEqual(await api(`/capture/devices/${device.id}`, { method: 'DELETE' }), {
        ok: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
      setCsrf('');
    }
    assert.equal((await batch()).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/capture/bridge/status',
          headers,
          payload: {},
        })
      ).statusCode,
      401,
    );
    assert.equal((db.prepare('SELECT count(*) AS n FROM comments').get() as any).n, 10);
    // Device revocation leaves the one session code usable; explicit rotation revokes both.
    const again = await pair();
    assert.equal(again.statusCode, 200, again.body);
    const changed = await app.inject({
      method: 'POST',
      url: `/api/capture/sessions/${streamId}/rotate`,
      headers: admin,
      payload: {},
    });
    assert.equal(changed.statusCode, 200, changed.body);
    const currentCode = changed.json().code;
    assert.notEqual(currentCode, code);
    assert.equal((await pair()).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/capture/bridge/status',
          headers: { ...ext, authorization: `Bearer ${again.json().credential}` },
          payload: {},
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/capture/bridge/status',
          headers: headers2,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal((await issue()).json().code, currentCode);
    await app.close();
    ({ app, db } = await createApp({ directory, setupToken: 'setup-test', collector: false }));
    assert.equal((await issue()).json().code, currentCode);
    assert.equal((await issue('456')).json().code, code2);
    assert.equal((db.prepare('SELECT count(*) AS n FROM comments').get() as any).n, 10);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('v1 to v8 migration preserves comments and repairs Facebook DOM metadata artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tns-migration-test-'));
  let db = openStore(directory);
  try {
    seedDemo(db);
    const count = streams(db)[0].commentCount;
    db.exec(
      'DROP TABLE capture_pairings; DROP TABLE capture_devices; ALTER TABLE comments DROP COLUMN timeBasis; ALTER TABLE comments DROP COLUMN identityBasis; ALTER TABLE comments DROP COLUMN idBasis; ALTER TABLE comments DROP COLUMN avatarUrl; ALTER TABLE comments DROP COLUMN firstNumber; ALTER TABLE comments DROP COLUMN secondNumber; ALTER TABLE comments DROP COLUMN thirdNumber; ALTER TABLE comments DROP COLUMN fourthNumber; ALTER TABLE comments DROP COLUMN fifthNumber; ALTER TABLE comments DROP COLUMN aiNumberNote; ALTER TABLE comments DROP COLUMN numbersRevision; DROP TABLE ai_call_logs; PRAGMA user_version=1;',
    );
    db.close();
    db = openStore(directory);
    assert.equal(db.pragma('user_version', { simple: true }), 8);
    assert.equal(streams(db)[0].commentCount, count);
    // Simulate an existing v2 installation, then apply only the additive v3 migration.
    db.exec(
      'DROP TABLE capture_pairings; DROP INDEX capture_devices_pairing; ALTER TABLE capture_devices DROP COLUMN pairedStreamId; ALTER TABLE comments DROP COLUMN avatarUrl; ALTER TABLE comments DROP COLUMN firstNumber; ALTER TABLE comments DROP COLUMN secondNumber; ALTER TABLE comments DROP COLUMN thirdNumber; ALTER TABLE comments DROP COLUMN fourthNumber; ALTER TABLE comments DROP COLUMN fifthNumber; ALTER TABLE comments DROP COLUMN aiNumberNote; ALTER TABLE comments DROP COLUMN numbersRevision; DROP TABLE ai_call_logs; PRAGMA user_version=2;',
    );
    db.close();
    db = openStore(directory);
    assert.equal(db.pragma('user_version', { simple: true }), 8);
    assert.equal(streams(db)[0].commentCount, count);
    db.prepare(
      "INSERT INTO streams(id,sourceId,facebookId,title,pageName,status,kind,createdAt) VALUES ('browser-stream','browser','42','Live','Facebook','PAUSED','browser',?)",
    ).run(Date.now());
    db.prepare(
      "INSERT INTO comments(id,streamId,authorId,authorName,message,normalized,createdAt,receivedAt,parentId,isHost,timeBasis,identityBasis,idBasis) VALUES ('fb:broken','browser-stream','profile','Online status indicatorActive','Henry Trinh\n1m\nChúc mừng anh nha','old',?,?,NULL,0,'observed','profile-url','facebook-id')",
    ).run(Date.now(), Date.now());
    db.exec(
      'ALTER TABLE comments DROP COLUMN avatarUrl; ALTER TABLE comments DROP COLUMN firstNumber; ALTER TABLE comments DROP COLUMN secondNumber; ALTER TABLE comments DROP COLUMN thirdNumber; ALTER TABLE comments DROP COLUMN fourthNumber; ALTER TABLE comments DROP COLUMN fifthNumber; ALTER TABLE comments DROP COLUMN aiNumberNote; ALTER TABLE comments DROP COLUMN numbersRevision; DROP TABLE ai_call_logs; PRAGMA user_version = 3;',
    );
    db.close();
    db = openStore(directory);
    const repaired = db.prepare("SELECT * FROM comments WHERE id='fb:broken'").get() as Comment;
    assert.equal(repaired.authorName, 'Henry Trinh');
    assert.equal(repaired.message, 'Chúc mừng anh nha');
    assert.equal(repaired.normalized, 'chúc mừng anh nha');
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Video URLs and author identities are canonicalized without confusing names with identity', () => {
  assert.equal(videoUrl('https://www.facebook.com/shop/videos/123/?tracking=1').id, '123');
  for (const u of [
    'bad',
    'https://evil.example/watch?v=123',
    'https://facebook.com.evil.example/videos/123',
    'http://facebook.com/videos/123',
    'https://www.facebook.com/share/v/abc',
    'https://www.facebook.com/',
  ])
    assert.throws(() => videoUrl(u));
  assert.equal(
    profileIdentity('https://m.facebook.com/profile.php?id=42&tracking=x'),
    'https://www.facebook.com/profile.php?id=42',
  );
  assert.equal(
    profileIdentity('https://www.facebook.com/Person.Name?ref=x'),
    'https://www.facebook.com/person.name',
  );
  assert.equal(profileIdentity('https://evil.example/Person.Name'), null);
  assert.equal(profileIdentity('Same display name'), null);
  assert.equal(profileIdentity('https://www.facebook.com/watch/?v=123'), null);
  assert.match(
    facebookAvatarUrl('https://scontent-lax3-1.xx.fbcdn.net/avatar.jpg?token=abc')!,
    /fbcdn\.net/,
  );
  assert.equal(facebookAvatarUrl('https://evil.example/avatar.jpg'), null);
});

test('Extension parser only extracts comment permalinks and profile URLs from supplied DOM attributes', async () => {
  const context = vm.createContext({ URL });
  vm.runInContext(
    await readFile(new URL('../extension/parser.js', import.meta.url), 'utf8'),
    context,
  );
  const p = context.TNSParser;
  assert.equal(p.video('https://www.facebook.com/watch/?v=42'), '42');
  assert.equal(p.video('https://facebook.com.evil.example/watch/?v=42'), null);
  assert.equal(
    p.identity('https://www.facebook.com/profile.php?id=7&ref=abc'),
    'https://www.facebook.com/profile.php?id=7',
  );
  assert.equal(p.identity('https://www.facebook.com/watch?v=7'), null);
  assert.equal(
    p.commentKey(['https://www.facebook.com/watch?v=42&comment_id=20&reply_comment_id=21']).id,
    'fb:21',
  );
  assert.equal(p.commentKey(['https://evil.example/?comment_id=42']).id, null);
  // Small visible-DOM fixture: author link, text body, permalink and a nested reply.
  const article: any = {
    getClientRects: () => [1],
    parentElement: { closest: () => null },
  };
  const author: any = {
    href: 'https://www.facebook.com/test.person',
    textContent: 'Test Person',
    closest: () => article,
    contains: (node: any) => node === author,
  };
  const part: any = {
    textContent: '5',
    innerText: '5',
    contains: () => false,
    getClientRects: () => [1],
    querySelector: () => null,
    closest: (selector: string) => (selector === '[role="article"]' ? article : null),
  };
  const nested = { ...part, textContent: 'Wrong reply', closest: () => ({}) };
  const permalink = {
    href: 'https://www.facebook.com/watch/?v=42&comment_id=50',
    textContent: '1m',
    closest: () => article,
  };
  article.querySelectorAll = (selector: string) =>
    selector === 'a[href]' ? [author, permalink] : [part, nested];
  context.getComputedStyle = () => ({ visibility: 'visible' });
  const parsed = p.read(article);
  assert.equal(parsed.message, '5');
  assert.equal(parsed.id, 'fb:50');
  assert.equal(parsed.authorName, 'Test Person');
  const statusAuthor: any = {
    ...author,
    textContent: 'Online status indicatorActive',
    innerText: 'Online status indicatorActive',
    contains: () => false,
  };
  const realAuthor: any = {
    ...author,
    textContent: 'Henry Trinh',
    innerText: 'Henry Trinh',
    querySelectorAll: () => [
      {
        href: {
          baseVal: 'https://scontent-lax3-1.xx.fbcdn.net/avatar.jpg?token=abc',
        },
        getAttribute: () => null,
      },
    ],
  };
  const timePart = { ...part, textContent: '1m', innerText: '1m' };
  const messagePart = { ...part, textContent: 'Chúc mừng anh nha', innerText: 'Chúc mừng anh nha' };
  article.querySelectorAll = (selector: string) =>
    selector === 'a[href]'
      ? [statusAuthor, realAuthor, permalink]
      : [timePart, messagePart, nested];
  const noisy = p.read(article);
  assert.equal(noisy.authorName, 'Henry Trinh');
  assert.equal(noisy.message, 'Chúc mừng anh nha');
  assert.ok(!noisy.message.includes('1m'));
  assert.match(noisy.avatarUrl, /fbcdn\.net/);
  assert.equal(p.avatarUrl('https://evil.example/avatar.jpg'), null);
  assert.deepEqual(
    sanitizeBrowserComment('Online status indicatorActive', 'Henry Trinh\n1m\nChúc mừng anh nha'),
    { authorName: 'Henry Trinh', message: 'Chúc mừng anh nha' },
  );
  article.getClientRects = () => [];
  assert.equal(p.read(article), null);
  const manifest = JSON.parse(
    await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(manifest.permissions, ['activeTab', 'alarms', 'scripting', 'storage']);
  assert.ok(!manifest.content_scripts && !manifest.externally_connectable);
  for (const file of ['parser.js', 'content.js', 'popup.js'])
    new vm.Script(
      await readFile(new URL(`../extension/${file}`, import.meta.url), 'utf8').then((s) =>
        file === 'popup.js' ? `(async()=>{${s}})()` : s,
      ),
    );
});
