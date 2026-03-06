import { int } from '@/utilities/parse.utility';

const DEFAULT_MAX_SIZE = 512;
const MAX_CACHE_SIZE = int(process.env.APP_ENV_LRU_CACHE_SIZE) || DEFAULT_MAX_SIZE;

export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly maxSize: number;

  constructor(opts: { maxSize: number } = { maxSize: MAX_CACHE_SIZE }) {
    this.maxSize = opts.maxSize;
  }

  // -----------------------------------------------------------------------
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      return undefined;
    }

    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  // -----------------------------------------------------------------------
  set(key: K, value: V) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey) {
        this.map.delete(firstKey);
      }
    }

    this.map.set(key, value);
  }

  // -----------------------------------------------------------------------
  getSize(): number {
    return this.map.size;
  }

  // -----------------------------------------------------------------------
  clear() {
    this.map.clear();
  }
}
