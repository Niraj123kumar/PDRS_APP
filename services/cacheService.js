const Redis = require('ioredis');

class CacheService {
    constructor() {
        this.redis = null;
        this.memoryCache = new Map();
        this.isRedisConnected = false;
        this.stats = {
            hits: 0,
            misses: 0
        };

        if (process.env.REDIS_URL) {
            try {
                this.redis = new Redis(process.env.REDIS_URL, {
                    maxRetriesPerRequest: 3,
                    retryStrategy: (times) => {
                        if (times > 3) return null; // stop retrying
                        return Math.min(times * 50, 2000);
                    }
                });

                this.redis.on('connect', () => {
                    this.isRedisConnected = true;
                    console.log('Redis connected');
                });

                this.redis.on('error', (err) => {
                    this.isRedisConnected = false;
                    console.warn('Redis error, falling back to in-memory cache:', err.message);
                });
            } catch (err) {
                console.warn('Failed to initialize Redis, using in-memory cache');
            }
        }
    }

    async set(key, value, ttlSeconds = 3600) {
        const serialized = JSON.stringify(value);
        if (this.isRedisConnected) {
            try {
                await this.redis.setex(key, ttlSeconds, serialized);
            } catch (err) {
                this.memoryCache.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
            }
        } else {
            this.memoryCache.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
        }
    }

    async get(key) {
        if (this.isRedisConnected) {
            try {
                const result = await this.redis.get(key);
                if (result) {
                    this.stats.hits++;
                    return JSON.parse(result);
                }
            } catch (err) {
                // fallback to memory
            }
        }

        const inMemory = this.memoryCache.get(key);
        if (inMemory) {
            if (inMemory.expires > Date.now()) {
                this.stats.hits++;
                return inMemory.value;
            } else {
                this.memoryCache.delete(key);
            }
        }

        this.stats.misses++;
        return null;
    }

    async del(key) {
        if (this.isRedisConnected) {
            try {
                await this.redis.del(key);
            } catch (err) {}
        }
        this.memoryCache.delete(key);
    }

    async invalidatePattern(pattern) {
        if (this.isRedisConnected) {
            try {
                const stream = this.redis.scanStream({ match: pattern });
                stream.on('data', (keys) => {
                    if (keys.length) {
                        this.redis.del(keys);
                    }
                });
            } catch (err) {}
        }

        // Memory cache invalidation (simple match)
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        for (const key of this.memoryCache.keys()) {
            if (regex.test(key)) {
                this.memoryCache.delete(key);
            }
        }
    }

    getStats() {
        const total = this.stats.hits + this.stats.misses;
        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            hitRate: total === 0 ? 0 : (this.stats.hits / total).toFixed(2),
            isRedisConnected: this.isRedisConnected
        };
    }
}

module.exports = new CacheService();
