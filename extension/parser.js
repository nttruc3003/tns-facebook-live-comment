// Isolated-world DOM reader. No Facebook requests, cookies, hidden state or auto-scroll.
(() => {
  function video(input) {
    try {
      const u = new URL(input);
      if (
        u.protocol !== 'https:' ||
        !['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(u.hostname)
      )
        return null;
      return (
        u.searchParams.get('v')?.match(/^\d+$/)?.[0] ||
        u.pathname.match(/\/videos\/(?:[^/]+\/)?(\d+)(?:\/|$)/)?.[1] ||
        null
      );
    } catch {
      return null;
    }
  }
  function identity(input) {
    try {
      const u = new URL(input);
      if (
        u.protocol !== 'https:' ||
        !['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(u.hostname)
      )
        return null;
      if (u.pathname === '/profile.php' && /^\d+$/.test(u.searchParams.get('id') || ''))
        return `https://www.facebook.com/profile.php?id=${u.searchParams.get('id')}`;
      if (/^\/people\/[^/]+\/\d+\/?$/.test(u.pathname))
        return `https://www.facebook.com${u.pathname.replace(/\/$/, '')}`;
      const slug = u.pathname.replace(/^\/|\/$/g, '');
      if (
        /^[a-zA-Z0-9.]{2,100}$/.test(slug) &&
        ![
          'watch',
          'videos',
          'reels',
          'groups',
          'photo',
          'photos',
          'stories',
          'share',
          'login',
          'help',
          'settings',
          'marketplace',
        ].includes(slug.toLowerCase())
      )
        return `https://www.facebook.com/${slug.toLowerCase()}`;
    } catch {}
    return null;
  }
  function commentKey(hrefs) {
    for (const href of hrefs) {
      try {
        const u = new URL(href);
        if (!['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(u.hostname)) continue;
        const root = u.searchParams.get('comment_id'),
          reply = u.searchParams.get('reply_comment_id');
        if (reply && /^\d+$/.test(reply))
          return {
            id: `fb:${reply}`,
            parentId: root && /^\d+$/.test(root) ? `fb:${root}` : 'unknown-reply',
          };
        if (root && /^\d+$/.test(root)) return { id: `fb:${root}`, parentId: null };
      } catch {}
    }
    return { id: null, parentId: null };
  }
  function visibleText(el) {
    const value = typeof el.innerText === 'string' ? el.innerText : el.textContent;
    return (value || '').replace(/\s+/g, ' ').trim();
  }
  function relativeTime(value) {
    return /^(?:just now|vừa xong|\d{1,4}\s*(?:s|m|h|d|w|min|mins|hr|hrs|giây|phút|giờ|ngày|tuần))$/iu.test(
      value,
    );
  }
  function cleanAuthor(value) {
    return value
      .replace(/online\s+status\s+indicator\s*(?:active|inactive)?/giu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function presenceLabel(value) {
    return /online\s+status\s+indicator/iu.test(value);
  }
  function avatarUrl(input) {
    try {
      const url = new URL(input);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        !['fbcdn.net', 'fbsbx.com'].some(
          (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
        )
      )
        return null;
      return url.toString();
    } catch {
      return null;
    }
  }
  function imageSource(image) {
    const value =
      image.currentSrc ||
      image.src ||
      image.href?.baseVal ||
      image.getAttribute?.('href') ||
      image.getAttribute?.('xlink:href');
    return typeof value === 'string' ? avatarUrl(value) : null;
  }
  function read(article) {
    if (!article.getClientRects().length || getComputedStyle(article).visibility === 'hidden')
      return null;
    const own = (el) => el.closest('[role="article"]') === article;
    const links = [...article.querySelectorAll('a[href]')].filter(own);
    const author = links
      .map((link) => ({ link, name: cleanAuthor(visibleText(link)) }))
      .find(({ link, name }) => identity(link.href) && name && !relativeTime(name));
    if (!author) return null;
    const parts = [...article.querySelectorAll('[dir="auto"]')].filter(
      (el) =>
        own(el) &&
        !el.contains(author.link) &&
        !author.link.contains(el) &&
        el.getClientRects().length &&
        !el.querySelector('[dir="auto"]') &&
        !el.closest('button,[role="button"]') &&
        visibleText(el),
    );
    // Refuse ambiguous layouts: the operator must preview sample messages before recording.
    const message = parts
      .map(visibleText)
      .filter((text) => text !== author.name && !relativeTime(text) && !presenceLabel(text))
      .join('\n')
      .trim();
    if (!message || message.length > 8000) return null;
    const key = commentKey(links.map((a) => a.href));
    const authorUrl = identity(author.link.href);
    const avatar = links
      .filter((link) => identity(link.href) === authorUrl)
      .flatMap((link) => [
        ...(link.querySelectorAll?.('img[src],image') || []),
      ])
      .map(imageSource)
      .find(Boolean);
    if (article.parentElement?.closest('[role="article"]') && !key.parentId)
      key.parentId = 'unknown-reply';
    return {
      ...key,
      authorName: author.name.slice(0, 200),
      authorUrl,
      avatarUrl: avatar || null,
      message,
    };
  }
  globalThis.TNSParser = { video, identity, avatarUrl, commentKey, read };
})();
