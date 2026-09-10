import { afterEach, describe, expect, it, vi } from "vitest";
import { sendLead } from "../src/shared/leads/send-lead.ts";

const payload = {
  name: "Тест",
  phone: "+79990000000",
  source: "https://impulse.ams24.ru/",
  honeypot: "",
  openedAt: 1,
  utm: {},
};

describe("AMS Leads API configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects an untrusted endpoint before sending lead PII", async () => {
    vi.stubEnv("NEXT_PUBLIC_LEADS_API_URL", "https://attacker.example/api/leads");
    vi.stubEnv("NEXT_PUBLIC_LEADS_PROJECT_ID", "ams-impulse");
    vi.stubEnv("NEXT_PUBLIC_LEADS_SITE_KEY", "public-site-key");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendLead(payload)).rejects.toThrow("Отправка заявок временно не настроена.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
