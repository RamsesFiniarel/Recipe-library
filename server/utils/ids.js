import { customAlphabet } from "nanoid";

// No look-alike characters (0/O, 1/l/I); 12 is short and plenty unique.
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
export const generateId = customAlphabet(ALPHABET, 12);
