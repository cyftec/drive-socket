import type { MessageKind, MessageRef } from '../../types/index.ts';

export function filterByKind(refs: MessageRef[], kind?: MessageKind): MessageRef[] {
  if (!kind) return refs;
  return refs.filter((ref) => ref.kind === kind);
}
