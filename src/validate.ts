import { RegisterStudentCommandPayloadV1Schema } from "@famashines/the-vps-contracts";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ajv = new Ajv2020({ allErrors: true });
addFormats.default(ajv);

export const validRegisterStudent = ajv.compile(structuredClone(RegisterStudentCommandPayloadV1Schema) as object);

export function fieldErrors(errors: ErrorObject[] | null | undefined) {
  return (errors ?? []).map((e) => {
    const path = e.instancePath.slice(1).replaceAll("/", ".");
    if (e.keyword === "required") return { field: [path, e.params.missingProperty].filter(Boolean).join("."), message: "is required" };
    if (e.keyword === "additionalProperties") return { field: [path, e.params.additionalProperty].filter(Boolean).join("."), message: "is not a known field" };
    return { field: path, message: e.message ?? "is not valid" };
  });
}
