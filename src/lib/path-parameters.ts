import { z } from "zod";

const boundedIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export const uuidPathParameterSchema = z.string().uuid();
export const onchainTaskIdPathParameterSchema = z.string().min(1).max(78).regex(/^[1-9][0-9]*$/);
export const agentIdPathParameterSchema = z.string().min(3).max(120).regex(boundedIdentifierPattern);
export const jobIdPathParameterSchema = z.string().min(1).max(200).regex(boundedIdentifierPattern);
export const demoTaskIdPathParameterSchema = z.string().min(1).max(120).regex(boundedIdentifierPattern);
