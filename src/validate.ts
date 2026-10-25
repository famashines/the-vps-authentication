import {
  CreateClassSectionCommandPayloadV1Schema,
  EnrollStudentCommandPayloadV1Schema,
  OpenAcademicYearCommandPayloadV1Schema,
  RegisterStudentCommandPayloadV1Schema,
} from "@famashines/the-vps-contracts";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ajv = new Ajv2020({ allErrors: true });
addFormats.default(ajv);

const compile = (schema: object) => ajv.compile(structuredClone(schema));

export const validRegisterStudent = compile(RegisterStudentCommandPayloadV1Schema);
export const validOpenAcademicYear = compile(OpenAcademicYearCommandPayloadV1Schema);
export const validCreateClassSection = compile(CreateClassSectionCommandPayloadV1Schema);
export const validEnrollStudent = compile(EnrollStudentCommandPayloadV1Schema);

export function fieldErrors(errors: ErrorObject[] | null | undefined) {
  const all = (errors ?? []).map((e) => {
    const path = e.instancePath.slice(1).replaceAll("/", ".");
    if (e.keyword === "required") return { field: [path, e.params.missingProperty].filter(Boolean).join("."), message: "is required" };
    if (e.keyword === "additionalProperties") return { field: [path, e.params.additionalProperty].filter(Boolean).join("."), message: "is not a known field" };
    return { field: path, message: e.message ?? "is not valid" };
  });
  return all.filter((e, i) => all.findIndex((f) => f.field === e.field) === i);
}
