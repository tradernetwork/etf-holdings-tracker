import { applyChromeOs } from "../plugins/with-chromeos";
import { columnStyle, contentMaxWidth, CONTENT_MAX, TABLE_MAX, WIDE_BREAKPOINT } from "../lib/layout";

describe("large-screen layout", () => {
  it("leaves phones and narrow windows untouched", () => {
    expect(contentMaxWidth(412)).toBeNull();
    expect(contentMaxWidth(WIDE_BREAKPOINT - 1, "table")).toBeNull();
    expect(columnStyle(412)).toEqual({});
  });
  it("caps and centres wide windows", () => {
    expect(contentMaxWidth(WIDE_BREAKPOINT)).toBe(CONTENT_MAX);
    expect(contentMaxWidth(1920, "table")).toBe(TABLE_MAX);
    expect(columnStyle(1366)).toEqual({ width: "100%", maxWidth: CONTENT_MAX, alignSelf: "center" });
  });
});

describe("ChromeOS manifest plugin", () => {
  const base = () => ({
    manifest: { application: [{ activity: [{ $: { "android:name": ".MainActivity" } }] }] },
  });
  it("marks touchscreen optional and the activity resizable", () => {
    const m = applyChromeOs(base() as never) as ReturnType<typeof base> & { manifest: any };
    const f = m.manifest["uses-feature"];
    expect(f).toContainEqual({ $: { "android:name": "android.hardware.touchscreen", "android:required": "false" } });
    expect(m.manifest.application[0].activity[0].$["android:resizeableActivity"]).toBe("true");
  });
  it("flips an existing required=true and is idempotent", () => {
    const b: any = base();
    b.manifest["uses-feature"] = [{ $: { "android:name": "android.hardware.touchscreen", "android:required": "true" } }];
    const once: any = applyChromeOs(b);
    const twice: any = applyChromeOs(once);
    const t = twice.manifest["uses-feature"].filter((x: any) => x.$["android:name"] === "android.hardware.touchscreen");
    expect(t).toHaveLength(1);
    expect(t[0].$["android:required"]).toBe("false");
  });
});
