// Minimal stub — satisfies TypeScript entry-point requirement.
// This file is not executed by Mend SCA; it exists only to make the
// project a valid TypeScript project that bun install can process.

// is-odd: declared via ^3.0.1 semver dep + patchedDependencies field (MECHANISM 1)
// is-even: declared via patch: protocol on dep value (MECHANISM 2)
import isOdd from "is-odd";
import isEven from "is-even";

const num = 3;
console.log(`${num} is odd: ${isOdd(num)}`);
console.log(`${num} is even: ${isEven(num)}`);

export { isOdd, isEven };