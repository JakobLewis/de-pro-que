export declare class KeyLock<KeyT extends string | number> {
    private queue;
    has(key: KeyT): boolean;
    acquire(key: KeyT): Promise<() => void>;
}
type PendingItem<Args extends any[], Result extends any> = {
    args: Args;
    resolve: (result: Result) => void;
    reject: (error: any) => void;
};
export declare class Deproque<Args extends any[], Result extends any> {
    readonly pending: PendingItem<Args, Result>[];
    readonly executing: Args[];
    readonly canExecute: (work: Args, executing: typeof this.executing, pending: typeof this.pending) => boolean;
    readonly execute: (...work: Args) => Promise<Result>;
    constructor(executor: (...args: Args) => Promise<Result>, decider: (args: Args, executing: Args[], pending: PendingItem<Args, Result>[]) => boolean);
    private createDeferred;
    protected start(data: Args): Promise<Result>;
    protected deferredStart(i: number, data: Args, resolve: (result: Result) => void, reject: (error: any) => void): Promise<void>;
    poll(): void;
    add(data: Args): Promise<Result>;
}
export {};
