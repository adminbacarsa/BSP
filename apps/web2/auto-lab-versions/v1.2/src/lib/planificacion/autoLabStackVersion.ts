import versions from '../../../auto-lab-versions/VERSIONS.json';

/** Versión del stack Auto Lab con snapshot restaurable en `auto-lab-versions/`. */
export const AUTO_LAB_STACK_VERSION = versions.current ?? '0.0';

export const AUTO_LAB_STACK_VERSION_LABEL =
    versions.versions?.find((v) => v.version === versions.current)?.label ?? '';
