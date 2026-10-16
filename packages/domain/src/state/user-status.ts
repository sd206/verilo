import { defineMachine } from "./machine";

/** app_user.status (section 5.1). */
export const USER_STATUSES = ["INVITED", "ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const userStatusMachine = defineMachine<UserStatus>({
  name: "user.status",
  states: USER_STATUSES,
  initial: "INVITED",
  transitions: {
    INVITED: ["ACTIVE", "DISABLED"],
    ACTIVE: ["DISABLED"],
    DISABLED: ["ACTIVE"],
  },
});
