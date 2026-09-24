/**
 * Shared wizard step definitions.
 * Single source of truth for step names and order across all wizard pages.
 */

export type PathType = 'minimal' | 'some-technical' | null;

const MINIMAL_STEPS = ['Voice', 'Phone', 'Flow', 'Summary', 'Try It'];
const TECHNICAL_STEPS = ['Pipeline', 'Model', 'Prompt', 'Voice', 'Phone', 'Flow', 'Summary', 'Try It'];

export function getWizardSteps(path: PathType, currentStep: string) {
  const steps = path === 'minimal' ? MINIMAL_STEPS : TECHNICAL_STEPS;
  const currentIndex = steps.indexOf(currentStep);

  return steps.map((label, i) => ({
    label,
    active: i === currentIndex,
    completed: i < currentIndex,
  }));
}
