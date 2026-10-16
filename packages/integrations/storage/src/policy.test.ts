import { describe, expect, it } from "vitest";
import { contentDisposition, MAX_UPLOAD_BYTES, storageKeyFor, uploadPolicyError } from "./policy";

describe("upload policy (section 17)", () => {
  it("accepts PDFs and images up to 15 MB", () => {
    expect(uploadPolicyError({ filename: "ts.pdf", contentType: "application/pdf", sizeBytes: MAX_UPLOAD_BYTES })).toBeNull();
    expect(uploadPolicyError({ filename: "shot.PNG", contentType: "image/png", sizeBytes: 1 })).toBeNull();
    expect(uploadPolicyError({ filename: "shot.jpeg", contentType: "image/jpeg", sizeBytes: 1 })).toBeNull();
  });
  it("rejects oversize, empty, wrong type and mismatched extension", () => {
    expect(uploadPolicyError({ filename: "a.pdf", contentType: "application/pdf", sizeBytes: MAX_UPLOAD_BYTES + 1 })).toMatch(/15 MB/);
    expect(uploadPolicyError({ filename: "a.pdf", contentType: "application/pdf", sizeBytes: 0 })).toMatch(/empty/);
    expect(uploadPolicyError({ filename: "a.html", contentType: "text/html", sizeBytes: 1 })).toMatch(/not allowed/);
    expect(uploadPolicyError({ filename: "a.exe", contentType: "application/pdf", sizeBytes: 1 })).toMatch(/extension/);
  });
  it("builds keys from ids only and safe Content-Disposition headers", () => {
    expect(storageKeyFor("f1", "x1")).toBe("firms/f1/files/x1");
    expect(contentDisposition('evil"\r\nname.pdf')).not.toMatch(/[\r\n]/);
    expect(contentDisposition("résumé.pdf")).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf");
  });
});
