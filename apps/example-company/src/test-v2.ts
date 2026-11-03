/** TEST ONLY: the Operations v2 approval header for an operation. */
export const approvalOf = (op: { operation_id: string; revision: string }) => ({
  "poppy-approval": `operation_id="${op.operation_id}", revision="${op.revision}"`,
});
