import type { Principal } from "../../auth/identity";
import type { PrivateRuntime } from "../runtime";

export interface MarketplaceContext {
  rt: PrivateRuntime;
  principal: Principal;
  request: Request;
  area: string | undefined;
  id: string | undefined;
  action: string | undefined;
}
