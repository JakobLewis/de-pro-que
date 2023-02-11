import { Deproque, KeyLock } from "./main.js";
import { writeFile, readFile, rm, mkdir } from "fs/promises";

/**
 * Multiple calls of writeFile() to the same file can cause corruption; see "https://github.com/nodejs/help/issues/2346".
 * By using Deproque and checking for writes to the same file, we can avoid this issue entirely
 */

const fileCount = 100;
const duplicateWrites = 10;
const averageFileSize = 100;

const writeMethods: { [name: string]: (arg: [string, string]) => Promise<void> } = {};

writeMethods['default'] = (args) => writeFile(...args);

const deproque = new Deproque<[string, string], void>(
    writeFile,
    (args, executing) => executing.filter(path => path[0] === args[0]).length === 0
);

writeMethods['deproque'] = (args) => deproque.add(args);

const keylock = new KeyLock();

writeMethods['keylock'] = async (args) => {
    const release_lock = await keylock.acquire(args[0]);
    const r = await writeFile(...args);
    release_lock();
    return r;
};


function randomString(n: number): string {
    let acc = '';
    while (acc.length < n) acc += Math.random().toString(32).slice(2);
    return acc.slice(0, n);
}

const randomFileContents = new Array<string>(fileCount * duplicateWrites);
const writeOrder = new Array<string>(fileCount * duplicateWrites);

for (let i = 0, n = fileCount * duplicateWrites; i < n; i += 1) {
    randomFileContents[i] = randomString(Math.floor(averageFileSize * 2 * Math.random()));
    writeOrder[i] = (i % fileCount).toString();
}

//writeOrder.slice(fileCount * (duplicateWrites - 1));
//randomFileContents.slice(fileCount * (duplicateWrites - 1));

{   // Shuffles the writeOrder, thank you https://stackoverflow.com/a/6274381
    let j, x, i;
    for (i = writeOrder.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        x = writeOrder[i]!;
        writeOrder[i] = writeOrder[j]!;
        writeOrder[j] = x;
    }
}

const contentIndexLookups = new Array<number>(fileCount);

for (let i = 0, n = fileCount; i < n; i += 1)
    contentIndexLookups[i] = writeOrder.lastIndexOf(i.toString());

const finalResults = new Array<[string, number, number, string[]]>();

(async () => {

    console.log(`Performing test over ${fileCount} files with an average file size of ${averageFileSize} and ${duplicateWrites} duplicate writes per file.`)

    try {
        await mkdir('./tests');
    } catch { }

    for (const methodName in writeMethods) {
        const method = writeMethods[methodName]!;
        const allWritePromises = new Array<Promise<any>>(fileCount * duplicateWrites);


        const t0 = Date.now();
        for (let i = 0, n = fileCount * duplicateWrites; i < n; i += 1)
            allWritePromises[i] = method(['./tests/' + writeOrder[i]!, randomFileContents[i]!]);

        await Promise.all(allWritePromises);
        const t1 = Date.now();

        const readPromises = new Array<Promise<Buffer>>(fileCount);
        for (let i = 0, n = fileCount; i < n; i += 1)
            readPromises[i] = readFile('./tests/' + i);
        const results = await Promise.all(readPromises);

        let corruptedFiles = 0;
        const mismatches = new Array<string>();

        for (let i = 0, n = fileCount; i < n; i += 1) {
            const lastWrittenFileContents = randomFileContents[writeOrder.lastIndexOf(i.toString())]!;

            if (lastWrittenFileContents !== results[i]!.toString()) {
                corruptedFiles += 1;
                mismatches.push(lastWrittenFileContents, results[i]!.toString());
            }

        }

        finalResults.push([methodName, t1 - t0, corruptedFiles, mismatches]);

        await rm('./tests', { recursive: true, force: true });
        await mkdir('./tests');
    }

    finalResults.sort((a, b) => a[1] - b[1]);

    const padding = Math.max(...finalResults.map(x => x[0].length));

    finalResults.forEach((x) => {
        console.log(`[${x[0]}]`.padEnd(padding + 2) + ` ${(duplicateWrites * fileCount) / x[1]} op/ms with ${x[2]} errors (${Math.round(x[2] * 100 / fileCount)}%)`)
    });

    //console.log(`[${methodName}]: ${(duplicateWrites * fileCount) / ((t1 - t0) * 1000)} writes per second with ${corruptedFiles} corruptions detected`);

})();



/*




function randomContent(n: number, s: number): Array<[string, string]> {
    let r = new Array<[string, string]>();
    for (let i = 0; i < n; i += 1)
        r.push(['./tests/' + randomString(1), randomString(s)])
    return r;
}

async function readContents(): Promise<Array<[string, string]>> {
    const result = await Promise.all(
        (await readdir('./tests'))
            .map(async (f) => [f, (await readFile('./tests/' + f)).toString()] as [string, string])
    );
    await rm('./tests', { force: true, recursive: true });
    await mkdir('./tests');
    return result;
}

function validateContents(writenStrings: Array<[string, string]>, readStrings: Array<[string, string]>): number {
    let errors = 0;
    const contentMap: Record<string, string | undefined> = {};

    for (const [filename, value] of writenStrings)
        contentMap[filename] = value;

    for (const [filename, value] of readStrings)
        if (contentMap[filename] !== value) errors += 1;

    return errors;
}

function testWithoutQueue(writeStrings: Array<[string, string]>): Promise<void[]> {
    return Promise.all(
        writeStrings.map((s) => writeFile(...s))
    );
}

function testWithQueue(writeStrings: Array<[string, string]>): Promise<void[]> {
    return Promise.all(
        writeStrings.map((s) => queue.add(s))
    );
}

(async () => {
    try {
        await mkdir('./tests');
    } catch { }

    const content = randomContent(300, 10);
    let t0: number; let t1: number;
    let result: Array<[string, string]>;
    let errors: number;

    console.log(`Performing ${content.length} writes with ${(new Set(content.map(n => n[0]))).size} duplicate targets`);

    t0 = Date.now();
    await testWithoutQueue(content);
    t1 = Date.now();

    result = await readContents();
    errors = validateContents(content, result);

    console.log(`writeFile(): ${errors} errors @ ${content.length / ((t1 - t0) * 1000)} op/s`)

    //

    t0 = Date.now();
    await testWithQueue(content);
    t1 = Date.now();


    result = await readContents();
    errors = validateContents(content, result);

    console.log(`queuedWriteFile(): ${errors} errors @ ${content.length / ((t1 - t0) * 1000)} op/s`);

})();



*/