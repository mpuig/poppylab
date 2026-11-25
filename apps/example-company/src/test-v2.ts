/** TEST ONLY: a user's approval header for an operation (Operations v3). */
export const approvalOf = (op: { operation_id: string; revision: string }) => ({
  "poppy-approval": `operation_id="${op.operation_id}", revision="${op.revision}", approver="user"`,
});
