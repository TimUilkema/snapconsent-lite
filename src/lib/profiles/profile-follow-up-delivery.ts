export type BaselineFollowUpActionKind = "reminder" | "new_request";

export type BaselineFollowUpPlaceholderDispatchInput = {
  actionKind: BaselineFollowUpActionKind;
  request: {
    id: string;
    profileId: string;
    consentPath: string;
    emailSnapshot: string;
  };
};

export type BaselineFollowUpPlaceholderDispatchResult = {
  deliveryMode: "placeholder";
  status: "recorded";
};

export async function dispatchPlaceholderBaselineFollowUp(
  input: BaselineFollowUpPlaceholderDispatchInput,
): Promise<BaselineFollowUpPlaceholderDispatchResult> {
  void input;

  return {
    deliveryMode: "placeholder",
    status: "recorded",
  };
}
