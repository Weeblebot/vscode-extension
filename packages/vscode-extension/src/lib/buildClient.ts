import type { BuiltArtifact } from '@weeble/api-client';

/** Asks the Weeble build service to bundle a project for publishing. */
export async function requestBuild(
  fetcher: typeof fetch,
  buildServiceUrl: string,
  token: string,
  input: {
    project: { entrypoint: string; files: Record<string, string> };
    dependencies: Record<string, string>;
  },
  signal?: AbortSignal,
): Promise<BuiltArtifact> {
  const baseUrl = buildServiceUrl.replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetcher(`${baseUrl}/build`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
      signal,
    });
  } catch {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('Build cancelled');
    }
    throw new Error(
      `Couldn't reach the Weeble build service at ${baseUrl}. Check your connection and the weeble.buildServiceUrl setting.`,
    );
  }
  const body = (await response.json()) as BuiltArtifact & { detail?: string };
  if (!response.ok) throw new Error(body.detail || `Build failed (${response.status})`);
  return body;
}
