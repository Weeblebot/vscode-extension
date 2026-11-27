import type { WorkspaceFileSystem } from '@weeble/project';

/** The deployment this folder is connected to, from `.weeble/project.json`. */
export interface Project {
  name: string;
  deployment: string;
  guild: string;
  entrypoint: string;
  files: string[];
  dependencies: Record<string, string>;
}

export const PROJECT_FILE = '.weeble/project.json';

/** Reads the connected deployment, or `undefined` when the folder has none. */
export async function readProject(fs: WorkspaceFileSystem): Promise<Project | undefined> {
  if (!(await fs.exists(PROJECT_FILE))) return undefined;
  const project = parseProject(await fs.readText(PROJECT_FILE));
  if (!(await fs.exists(project.entrypoint))) {
    throw new Error(`Deployment entrypoint does not exist: ${project.entrypoint}`);
  }
  return project;
}

function parseProject(source: string): Project {
  const value = JSON.parse(source) as Partial<Project> & { version?: number };
  if (
    value.version !== 1 ||
    !value.name ||
    !value.deployment ||
    !value.guild ||
    !value.entrypoint ||
    !Array.isArray(value.files)
  ) {
    throw new Error(`Invalid ${PROJECT_FILE}`);
  }
  return {
    name: value.name,
    deployment: value.deployment,
    guild: value.guild,
    entrypoint: value.entrypoint,
    files: value.files,
    dependencies: value.dependencies ?? {},
  };
}
