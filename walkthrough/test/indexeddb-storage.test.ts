import "fake-indexeddb/auto";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { IndexedDbStorage } from "../src/vendor/indexeddb-storage.ts";

let n = 0;
registerStorageConformance({ describe, expect, it }, "IndexedDbStorage (vendored, pi-durable 1.3.0 rules)", async (use) => {
	const storage = await IndexedDbStorage.open(`db${n++}`, { indexedDB: new IDBFactory() });
	try {
		await use(storage);
	} finally {
		await storage.close();
	}
});
