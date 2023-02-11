export class KeyLock<KeyT extends string | number> {
    private queue = new Array<{
        promise: Promise<void>,
        key: KeyT,
    }>();

    has(key: KeyT): boolean {
        for (const x of this.queue)
            if (x.key === key)
                return true;
        return false;
    }

    async acquire(key: KeyT): Promise<() => void> {
        let resolve: () => void;
        const promise = new Promise((_resolve, _reject) => {
            resolve = _resolve;
        }) as Promise<void>;

        const dependents = new Array<Promise<any>>();
        for (const previousEntry of this.queue)
            if (previousEntry.key === key)
                dependents.push(previousEntry.promise);

        const task = { key, promise };
        this.queue.push(task);
        promise.then(() => this.queue.splice(this.queue.indexOf(task), 1));

        await Promise.all(dependents);

        let resolved = false;

        setTimeout(() => {
            if (!resolved) console.warn(`Lock<${key}> has been held for more than 5 seconds`);
        }, 5000).unref();

        return () => {
            resolved = true;
            resolve();
        };
    }
}

type PendingItem<Args extends any[], Result extends any> = {
    args: Args,
    resolve: (result: Result) => void,
    reject: (error: any) => void
}

export class Deproque<Args extends any[], Result extends any> {

    readonly pending = new Array<PendingItem<Args, Result>>();
    readonly executing = new Array<Args>();

    readonly canExecute: (work: Args, executing: typeof this.executing, pending: typeof this.pending) => boolean;
    readonly execute: (...work: Args) => Promise<Result>;

    constructor(
        executor: (...args: Args) => Promise<Result>,
        decider: (args: Args, executing: Args[], pending: PendingItem<Args, Result>[]) => boolean
    ) {
        this.execute = executor;
        this.canExecute = decider;
    }

    private createDeferred(): {
        promise: Promise<Result>,
        resolve: (result: Result) => void,
        reject: (error: any) => void
    } {
        let resolve: (result: Result) => void;
        let reject: (error: any) => void;
        let promise = new Promise((r, e) => {
            resolve = r;
            reject = e;
        }) as Promise<Result>;
        // @ts-expect-error
        return { promise, resolve, reject };
    }

    protected async start(data: Args): Promise<Result> {
        this.executing.push(data);
        const promise = this.execute(...data);
        promise.finally(() => {
            this.executing.splice(this.executing.indexOf(data), 1);
            this.poll();
        });
        return promise;
    }

    protected async deferredStart(i: number, data: Args, resolve: (result: Result) => void, reject: (error: any) => void) {
        this.pending.splice(i, 1);
        try {
            resolve(await this.start(data));
        } catch (e) {
            reject(e);
        }
    }

    poll(): void {
        for (let i = 0; i < this.pending.length; i += 1) {
            const { args: data, resolve, reject } = this.pending[i]!;
            if (this.canExecute(data, this.executing, this.pending)) this.deferredStart(i, data, resolve, reject);
        }
    }

    add(data: Args): Promise<Result> {
        if (this.canExecute(data, this.executing, this.pending)) return this.start(data);

        const { promise, resolve, reject } = this.createDeferred();

        this.pending.push({
            args: data, resolve, reject
        });

        return promise;
    }
}