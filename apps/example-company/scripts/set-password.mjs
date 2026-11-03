import process from "node:process";
import { randomBytes, scryptSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
if (!process.stdin.isTTY)
  throw new Error("Run this in an interactive terminal.");
process.stdout.write("New local Alex password (12–128 characters, hidden): ");
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
let password = "";
process.stdin.on("data", (data) => {
  for (const char of data) {
    if (char === "\u0003") {
      process.stdout.write("\nCancelled.\n");
      process.exit(1);
    }
    if (char === "\r" || char === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (password.length < 12 || password.length > 128)
        throw new Error("Use 12–128 characters.");
      const salt = randomBytes(16).toString("hex");
      const hash = scryptSync(password, salt, 64).toString("hex");
      password = "";
      const filename = fileURLToPath(new URL("../.env.local", import.meta.url));
      // Refuse to overwrite any existing configuration.
      writeFileSync(filename, `JUNIPER_PASSWORD_HASH=${salt}:${hash}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      process.stdout.write(
        "Saved password hash to apps/example-company/.env.local. Restart the Company server. No password was stored.\n",
      );
      process.exit(0);
    }
    if (char === "\u007f") {
      password = password.slice(0, -1);
    } else if (char >= " " && password.length < 129) password += char;
  }
});
