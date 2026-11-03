import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
  chmodSync,
} from "node:fs";
import path from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
/** Local single-writer encrypted snapshots. A key beside the data is local protection,
 * not a substitute for an external KMS or encrypted backups in production. */
export function vault<T>(
  name: string,
  initial: () => T,
  directory = path.join(process.cwd(), ".poppy"),
) {
  if (
    process.env.NODE_ENV === "test" &&
    directory === path.join(process.cwd(), ".poppy")
  )
    return { value: initial(), save: () => {} };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const keyfile = path.join(directory, "storage.key");
  try {
    writeFileSync(keyfile, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const key = readFileSync(keyfile);
  if (key.length !== 32) throw new Error("Invalid local storage key");
  const filename = path.join(directory, `${name}.enc`);
  let value: T;
  let loaded = false;
  try {
    const data = readFileSync(filename);
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(data.subarray(12, 28));
    value = JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString(),
    ) as T;
    loaded = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(
        "Encrypted storage could not be opened; preserve data and restore the matching key.",
        { cause: e },
      );
    value = initial();
  }
  // Only commit changed snapshots. Read-only polling must not encrypt/fsync.
  let committed = loaded ? JSON.stringify(value) : undefined;
  return {
    value,
    save() {
      const serialized = JSON.stringify(value);
      if (serialized === committed) return;
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(name));
      const ciphertext = Buffer.concat([
        cipher.update(serialized),
        cipher.final(),
      ]);
      const tmp = `${filename}.${process.pid}.tmp`;
      writeFileSync(tmp, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), {
        mode: 0o600,
      });
      const fd = openSync(tmp, "r");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, filename);
      const dir = openSync(/* turbopackIgnore: true */ directory, "r");
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
      committed = serialized;
    },
  };
}
