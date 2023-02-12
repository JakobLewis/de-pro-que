export class KeyLock {
    queue = new Array();
    has(key) {
        for (const x of this.queue)
            if (x.key === key)
                return true;
        return false;
    }
    async acquire(key) {
        let resolve;
        const promise = new Promise((_resolve, _reject) => {
            resolve = _resolve;
        });
        const dependents = new Array();
        for (const previousEntry of this.queue)
            if (previousEntry.key === key)
                dependents.push(previousEntry.promise);
        const task = { key, promise };
        this.queue.push(task);
        promise.then(() => this.queue.splice(this.queue.indexOf(task), 1));
        await Promise.all(dependents);
        let resolved = false;
        setTimeout(() => {
            if (!resolved)
                console.warn(`Lock<${key}> has been held for more than 5 seconds`);
        }, 5000).unref();
        return () => {
            resolved = true;
            resolve();
        };
    }
    wrap(func) {
        return async (key) => {
            const unlock = await this.acquire(key);
            const result = func(key);
            unlock();
            return result;
        };
    }
}
export class CustomLock {
    queue = new Array();
    addAccessor(executor, filter) {
        return async (arg) => {
            let resolve;
            const promise = new Promise((_resolve, _reject) => {
                resolve = _resolve;
            });
            const task = { promise, arg };
            const dependents = filter(arg, this.queue);
            this.queue.push(task);
            await Promise.all(dependents);
            try {
                return (await executor(arg));
            }
            catch (e) {
                throw e;
            }
            finally {
                this.queue.splice(this.queue.indexOf(task), 1);
                // @ts-expect-error
                resolve();
            }
        };
    }
}
export class Deproque {
    pending = new Array();
    executing = new Array();
    canExecute;
    execute;
    constructor(executor, decider) {
        this.execute = executor;
        this.canExecute = decider;
    }
    createDeferred() {
        let resolve;
        let reject;
        let promise = new Promise((r, e) => {
            resolve = r;
            reject = e;
        });
        // @ts-expect-error
        return { promise, resolve, reject };
    }
    async start(data) {
        this.executing.push(data);
        const promise = this.execute(...data);
        promise.finally(() => {
            this.executing.splice(this.executing.indexOf(data), 1);
            this.poll();
        });
        return promise;
    }
    async deferredStart(i, data, resolve, reject) {
        this.pending.splice(i, 1);
        try {
            resolve(await this.start(data));
        }
        catch (e) {
            reject(e);
        }
    }
    poll() {
        for (let i = 0; i < this.pending.length; i += 1) {
            const { args: data, resolve, reject } = this.pending[i];
            if (this.canExecute(data, this.executing, this.pending))
                this.deferredStart(i, data, resolve, reject);
        }
    }
    add(data) {
        if (this.canExecute(data, this.executing, this.pending))
            return this.start(data);
        const { promise, resolve, reject } = this.createDeferred();
        this.pending.push({
            args: data, resolve, reject
        });
        return promise;
    }
}
