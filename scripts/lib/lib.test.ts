import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { parseBroadcast } from "./broadcast.js";
import { parseEnv, upsertEnv } from "./env.js";
import { ANVIL_KEYS, assertLocalChain } from "./keys.js";
import { assertInsideRepo } from "./safety.js";

describe("env", () => {
  const base = "# chain\nCHAIN_ID=31337\nESCROW_ADDRESS=\n\nLOG_LEVEL=info # note\n";

  it("updates in place, keeps comments, appends new keys", () => {
    const out = upsertEnv(base, { ESCROW_ADDRESS: "0xabc", NEW_KEY: "1" });
    expect(out).toContain("# chain\nCHAIN_ID=31337\nESCROW_ADDRESS=0xabc\n");
    expect(out.endsWith("NEW_KEY=1\n")).toBe(true);
    expect(out.match(/ESCROW_ADDRESS/g)).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = upsertEnv(base, { ESCROW_ADDRESS: "0xabc" });
    expect(upsertEnv(once, { ESCROW_ADDRESS: "0xabc" })).toBe(once);
  });

  it("parses values and strips trailing comments", () => {
    expect(parseEnv(base)).toEqual({ CHAIN_ID: "31337", ESCROW_ADDRESS: "", LOG_LEVEL: "info" });
  });
});

describe("broadcast", () => {
  it("extracts lowercase addresses", () => {
    const d = parseBroadcast({
      transactions: [
        {
          transactionType: "CREATE",
          contractName: "MockUSDC",
          contractAddress: "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa",
        },
        {
          transactionType: "CREATE",
          contractName: "RecourseEscrow",
          contractAddress: "0xBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbb",
        },
        {
          transactionType: "CALL",
          contractName: "MockUSDC",
          contractAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
        },
      ],
    });
    expect(d).toEqual({ escrow: "0x" + "b".repeat(40), token: "0x" + "a".repeat(40) });
  });

  it("allows an external token and rejects a missing escrow", () => {
    expect(
      parseBroadcast({
        transactions: [
          {
            transactionType: "CREATE",
            contractName: "RecourseEscrow",
            contractAddress: "0x" + "1".repeat(40),
          },
        ],
      }).token,
    ).toBeNull();
    expect(() => parseBroadcast({ transactions: [] })).toThrow(/RecourseEscrow/);
    expect(() => parseBroadcast(null)).toThrow();
  });
});

describe("safety", () => {
  it("allows paths strictly inside the repo", () => {
    expect(assertInsideRepo("/repo", "./data")).toBe("/repo/data");
  });
  it.each(["/", "..", "../x", "/etc", ".", "./", "data/../.."])("refuses %s", (p) => {
    expect(() => assertInsideRepo("/repo", p)).toThrow(/refusing/);
  });
});

describe("keys", () => {
  it("anvil keys are distinct valid keys", () => {
    const addrs = Object.values(ANVIL_KEYS).map((k) => privateKeyToAccount(k).address);
    expect(new Set(addrs).size).toBe(6);
    // anvil account 0
    expect(addrs[0]).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  });
  it("is local-only", () => {
    expect(() => assertLocalChain(31337)).not.toThrow();
    expect(() => assertLocalChain(84532)).toThrow(/local-only/);
  });
});

import { findSecrets } from "./secrets.js";

describe("secret scan", () => {
  const real = "0x" + "ab".repeat(32);
  const anvil = ANVIL_KEYS.OWNER_PRIVATE_KEY;

  it("flags a non-anvil key assignment in several syntaxes", () => {
    for (const text of [
      `PRIVATE_KEY=${real}`,
      `const privateKey = "${real}"`,
      `{ "secret": "${real}" }`,
      `MNEMONIC: ${real}`,
    ]) {
      expect(findSecrets([{ path: "a.ts", text }])).toHaveLength(1);
    }
  });

  it("allows anvil dev keys, bare hashes and the example env", () => {
    expect(
      findSecrets([
        { path: "a.ts", text: `OWNER_PRIVATE_KEY=${anvil.toUpperCase().replace("0X", "0x")}` },
      ]),
    ).toEqual([]);
    expect(findSecrets([{ path: "a.ts", text: `const root = "${real}"` }])).toEqual([]);
    expect(findSecrets([{ path: ".env.example", text: "OWNER_PRIVATE_KEY=" }])).toEqual([]);
  });

  it("flags committed env files and PEM keys", () => {
    expect(findSecrets([{ path: ".env", text: "" }])).toHaveLength(1);
    expect(findSecrets([{ path: "apps/api/.env.production", text: "" }])).toHaveLength(1);
    expect(findSecrets([{ path: "k.pem", text: "-----BEGIN " + "PRIVATE KEY-----" }])).toHaveLength(
      1,
    );
  });
});
