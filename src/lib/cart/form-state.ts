export interface CartActionState {
  readonly status: "idle" | "success" | "error";
  readonly message?: string;
}

export const INITIAL_CART_ACTION_STATE: CartActionState = {
  status: "idle",
};