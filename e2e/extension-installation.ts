import path from "node:path";
import { realpath } from "node:fs/promises";

export interface InstalledExtension {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
}

export interface ExtensionInstaller {
  list(): Promise<InstalledExtension[]>;
  load(extensionPath: string): Promise<string>;
  uninstall(id: string): Promise<void>;
}

async function canonicalPath(value: string): Promise<string> {
  try {
    return await realpath(value);
  } catch {
    return path.resolve(value);
  }
}

async function inventory(
  installer: ExtensionInstaller,
): Promise<InstalledExtension[]> {
  return Promise.all(
    (await installer.list()).map(async (extension) => ({
      ...extension,
      path: await canonicalPath(extension.path),
    })),
  );
}

/** Tracks only this test's unique unpacked path, including an uncertain load outcome. */
export class TestExtensionInstallation {
  private baseline?: Set<string>;
  private attempted = false;
  private ownedPaths?: Set<string>;

  constructor(private readonly extensionPath: string) {}

  private owns(extension: InstalledExtension): boolean {
    return (
      this.attempted &&
      this.baseline !== undefined &&
      !this.baseline.has(extension.id) &&
      this.ownedPaths?.has(extension.path) === true
    );
  }

  async load(
    installer: ExtensionInstaller,
    borrowed: boolean,
    allowedDisabled?: { id: string; path: string },
  ): Promise<string> {
    const resolved = await canonicalPath(this.extensionPath);
    this.ownedPaths ??= new Set([path.resolve(this.extensionPath), resolved]);
    if (!this.ownedPaths.has(resolved))
      throw new Error("The test extension path changed; refusing to load it");
    const extensions = await inventory(installer);
    const suspendedPath = allowedDisabled
      ? await canonicalPath(allowedDisabled.path)
      : undefined;
    this.baseline ??= new Set(extensions.map((extension) => extension.id));
    if (
      extensions.some(
        (extension) =>
          !this.owns(extension) &&
          (this.ownedPaths!.has(extension.path) ||
            (borrowed &&
              extension.name.toLowerCase().startsWith("datafog") &&
              !(
                allowedDisabled?.id === extension.id &&
                suspendedPath === extension.path &&
                !extension.enabled
              ))),
      )
    ) {
      throw new Error(
        "This browser already has datafog installed. Use the dedicated sign-in profile so the live suite does not change an existing vault.",
      );
    }
    // Register the attempt before the protocol call: it may install and then
    // disconnect without returning an id. The unique path and baseline still
    // distinguish that installation from every preexisting extension.
    this.attempted = true;
    const id = await installer.load(this.extensionPath);
    if (this.baseline.has(id))
      throw new Error(
        "The test installation returned a preexisting extension id; refusing to claim it.",
      );
    return id;
  }

  async remove(installer: ExtensionInstaller): Promise<void> {
    if (!this.attempted) return;
    const extensions = await inventory(installer);
    const failures: unknown[] = [];
    for (const extension of extensions.filter((candidate) =>
      this.owns(candidate),
    )) {
      try {
        console.log(
          "Removing owned test extension:",
          JSON.stringify({ id: extension.id, path: extension.path }),
        );
        await installer.uninstall(extension.id);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Could not remove the test-installed extension",
      );
    this.attempted = false;
  }
}
