// Markers around the arm-strength section of docs/AUGMENT_REPORT.md.
// tools/augment/arm.ts writes the section between them; tools/augment/build.ts
// rewrites the rest of the report and keeps the section.

export const ARM_REPORT_BEGIN = '<!-- BEGIN tools/augment/arm.ts -->';
export const ARM_REPORT_END = '<!-- END tools/augment/arm.ts -->';
