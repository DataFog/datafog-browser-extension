/** Explicit target ownership for borrowed, multi-profile Chrome sessions. */
export interface TargetIdentity {
  targetId: string;
  browserContextId?: string;
}

export function requireContext(
  target: TargetIdentity,
  contextId: string,
): void {
  if (!contextId || target.browserContextId !== contextId)
    throw new Error(
      "Chrome target is outside the explicitly selected browser context",
    );
}

export async function createPinnedPage<T>(
  contextId: string,
  api: {
    create(url: string, contextId: string): Promise<string>;
    resolve(url: string): Promise<{ page: T; target: TargetIdentity }>;
    close(targetId: string): Promise<void>;
  },
): Promise<T> {
  if (!contextId) throw new Error("An explicit browser context is required");
  const url = `about:blank#datafog-owned-${crypto.randomUUID()}`;
  const targetId = await api.create(url, contextId);
  try {
    const { page, target } = await api.resolve(url);
    if (target.targetId !== targetId)
      throw new Error("Chrome returned a different page target");
    requireContext(target, contextId);
    return page;
  } catch (error) {
    // Only the target created by this attempt belongs to this cleanup.
    await api.close(targetId);
    throw error;
  }
}
