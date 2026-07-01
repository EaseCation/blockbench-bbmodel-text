import { DEFAULT_TEXT_ROTATION, RotationTuple, sanitizeRotation } from '../core/rotation';

const GLOBAL_DEFAULT_ROTATION_KEY = 'bbmodel_text_component.default_rotation.v2';

let projectDefaultRotationProperty: any | undefined;

export function registerProjectSettingsProperties(): void {
  if (typeof ModelProject === 'undefined') return;
  if (!ModelProject.properties?.bb_text_default_rotation_v2) {
    projectDefaultRotationProperty = new Property(ModelProject, 'vector', 'bb_text_default_rotation_v2', {
      default: DEFAULT_TEXT_ROTATION,
    });
  }
}

export function unregisterProjectSettingsProperties(): void {
  projectDefaultRotationProperty?.delete?.();
  projectDefaultRotationProperty = undefined;
}

function getStoredGlobalRotation(): RotationTuple {
  try {
    const raw = localStorage.getItem(GLOBAL_DEFAULT_ROTATION_KEY);
    return raw ? sanitizeRotation(JSON.parse(raw)) : DEFAULT_TEXT_ROTATION.slice() as RotationTuple;
  } catch {
    return DEFAULT_TEXT_ROTATION.slice() as RotationTuple;
  }
}

export function getTextDefaultRotation(): RotationTuple {
  const projectRotation = (Project as any)?.bb_text_default_rotation_v2;
  if (Array.isArray(projectRotation)) {
    return sanitizeRotation(projectRotation);
  }
  return getStoredGlobalRotation();
}

export function setTextDefaultRotation(rotation: unknown): RotationTuple {
  const sanitized = sanitizeRotation(rotation);
  if (Project) {
    const project = Project as any;
    if (Array.isArray(project.bb_text_default_rotation_v2) && typeof project.bb_text_default_rotation_v2.replace === 'function') {
      project.bb_text_default_rotation_v2.replace(sanitized);
    } else {
      project.bb_text_default_rotation_v2 = sanitized.slice();
    }
    Project.saved = false;
  }

  try {
    localStorage.setItem(GLOBAL_DEFAULT_ROTATION_KEY, JSON.stringify(sanitized));
  } catch {
    // Local storage may be unavailable or full; the project value still works.
  }
  return sanitized;
}
