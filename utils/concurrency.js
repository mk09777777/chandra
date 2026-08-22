function createConcurrencyLimiter(max) {
    let active = 0;
    const queue = [];

    function next() {
        if (queue.length > 0 && active < max) {
            const { wrappedFn, args, resolve, reject } = queue.shift();
            active++;
            wrappedFn(...args).then(resolve, reject).finally(() => {
                active--;
                next();
            });
        }
    }

    return function wrapLimited(wrappedFn) {
        return async function (...args) {
            if (active < max) {
                active++;
                try {
                    return await wrappedFn(...args);
                } finally {
                    active--;
                    next();
                }
            }
            return new Promise((resolve, reject) => {
                queue.push({ wrappedFn, args, resolve, reject });
            });
        };
    };
}

module.exports = { createConcurrencyLimiter };
