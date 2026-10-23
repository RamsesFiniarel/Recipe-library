import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/** Minimal dependency-free .xlsx reader for the Ciqual file. Supports plain
 * zips (stored/deflated, not zip64), as Excel writes them. */

function unzip(buffer) {
  const EOCD = 0x06054b50;
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== EOCD) eocd -= 1;
  if (eocd < 0) throw new Error("Archive .xlsx illisible (fin de répertoire zip introuvable)");

  const entries = new Map();
  let offset = buffer.readUInt32LE(eocd + 16);
  const count = buffer.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, () => (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      return String.fromCodePoint(entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    }
    return ENTITIES[entity] ?? match;
  });
}

function columnIndex(cellRef) {
  let index = 0;
  for (const char of cellRef.match(/^[A-Z]+/)[0]) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

/** Every sheet's rows as arrays of cell values (undefined when empty),
 * keyed by sheet name. */
export function readWorkbook(path) {
  const zip = unzip(readFileSync(path));
  const part = (name) => {
    const read = zip.get(name);
    if (!read) throw new Error(`Partie « ${name} » absente du fichier .xlsx`);
    return read();
  };

  const sharedStrings = zip.has("xl/sharedStrings.xml")
    ? [...part("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) =>
        decodeXml([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(([, t]) => t).join(""))
      )
    : [];

  const targets = new Map(
    [...part("xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(
      ([, id, target]) => [id, target.replace(/^\/?(xl\/)?/, "xl/")]
    )
  );

  const sheets = new Map();
  for (const [, attributes] of part("xl/workbook.xml").matchAll(/<sheet ([^>]*)\/>/g)) {
    const name = decodeXml(attributes.match(/name="([^"]*)"/)[1]);
    const target = targets.get(attributes.match(/r:id="([^"]*)"/)[1]);
    const rows = [];
    for (const [, rowXml] of part(target).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const [, cellAttributes, cellXml = ""] of rowXml.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const index = columnIndex(cellAttributes.match(/r="([A-Z]+\d+)"/)[1]);
        const type = cellAttributes.match(/t="([^"]*)"/)?.[1];
        const raw = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (type === "s") row[index] = sharedStrings[Number(raw)];
        else if (type === "inlineStr") row[index] = decodeXml(cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "");
        else if (type === "str") row[index] = decodeXml(raw ?? "");
        else if (raw !== undefined) row[index] = Number(raw);
      }
      rows.push(row);
    }
    sheets.set(name, rows);
  }
  return sheets;
}
