// Keep a fixed snapshot of the filtered IDs, even when filled values change filters.
export async function autofillInChunks<T>(options: {
  ids: string[];
  size: 10 | 20;
  stopped: () => boolean;
  request: (ids: string[]) => Promise<T>;
  apply: (result: T) => void;
  progress: (done: number) => void;
}) {
  let done = 0;
  while (done < options.ids.length && !options.stopped()) {
    const ids = options.ids.slice(done, done + options.size);
    try {
      const result = await options.request(ids);
      options.apply(result);
      done += ids.length;
      options.progress(done);
    } catch (error) {
      return { done, remaining: options.ids.slice(done), error: (error as Error).message };
    }
  }
  return { done, remaining: options.ids.slice(done), error: '' };
}
