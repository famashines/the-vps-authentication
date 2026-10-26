import {
  ChangeStudentClassCommandPayloadV1Schema,
  CloseClassCommandPayloadV1Schema,
  EnrollStudentCommandPayloadV1Schema,
  OpenAcademicYearCommandPayloadV1Schema,
  OpenClassCommandPayloadV1Schema,
  RegisterStudentCommandPayloadV1Schema,
  UpdateAcademicYearCommandPayloadV1Schema,
  UpdateStudentDetailsCommandPayloadV1Schema,
  ReceivePaymentCommandPayloadV1Schema,
  ReverseChargeCommandPayloadV1Schema,
  ReversePaymentCommandPayloadV1Schema,
  SetFeeScheduleCommandPayloadV1Schema,
} from "@famashines/the-vps-contracts";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ajv = new Ajv2020({ allErrors: true });
addFormats.default(ajv);

const compile = (schema: object) => ajv.compile(structuredClone(schema));

export const validRegisterStudent = compile(RegisterStudentCommandPayloadV1Schema);
export const validOpenAcademicYear = compile(OpenAcademicYearCommandPayloadV1Schema);
export const validOpenClass = compile(OpenClassCommandPayloadV1Schema);
export const validCloseClass = compile(CloseClassCommandPayloadV1Schema);
export const validEnrollStudent = compile(EnrollStudentCommandPayloadV1Schema);
export const validUpdateStudentDetails = compile(UpdateStudentDetailsCommandPayloadV1Schema);
export const validChangeStudentClass = compile(ChangeStudentClassCommandPayloadV1Schema);
export const validUpdateAcademicYear = compile(UpdateAcademicYearCommandPayloadV1Schema);
export const validSetFeeSchedule = compile(SetFeeScheduleCommandPayloadV1Schema);
export const validReceivePayment = compile(ReceivePaymentCommandPayloadV1Schema);
export const validReverseCharge = compile(ReverseChargeCommandPayloadV1Schema);
export const validReversePayment = compile(ReversePaymentCommandPayloadV1Schema);

export function fieldErrors(errors: ErrorObject[] | null | undefined) {
  const all = (errors ?? []).map((e) => {
    const path = e.instancePath.slice(1).replaceAll("/", ".");
    if (e.keyword === "required") return { field: [path, e.params.missingProperty].filter(Boolean).join("."), message: "is required" };
    if (e.keyword === "additionalProperties") return { field: [path, e.params.additionalProperty].filter(Boolean).join("."), message: "is not a known field" };
    return { field: path, message: e.message ?? "is not valid" };
  });
  return all.filter((e, i) => all.findIndex((f) => f.field === e.field) === i);
}
