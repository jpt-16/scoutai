/**
 * A starter sheet for the staff's own playbook (the "Our playbook" upload): one
 * row per play, in the same columns a Hudl breakdown uses, so it goes through
 * the exact same parser. Only the formation and the play call are needed; the
 * rest of a Hudl row (down, distance, yard line, front) doesn't apply to a
 * playbook. Framework-free so Vitest can read it.
 */
export const PLAYBOOK_TEMPLATE_NAME = "our-playbook-template.csv";

export const PLAYBOOK_TEMPLATE_CSV = [
  "PLAY #,OFF FORM,OFF STR,OFF PLAY,PLAY DIR",
  "1,TRIPS,R,QUICK SLANT,R",
  "2,DEUCES,R,MESH RAIL,R",
  "3,I-FORM,R,G ISO,R",
  "4,TRIO,L,RPO BUBBLE,L",
  "5,DEUCES,R,SMASH,R",
].join("\n");
