import { strToU8, zipSync } from 'fflate';

/**
 * Builds a minimal, valid .docx (Office Open XML) file entirely in the browser.
 * A .docx is just a ZIP of XML parts; `fflate` zips them with no workers or
 * native code, so the whole conversion stays on-device.
 */

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const EMU_PER_INCH = 914400;
const CONTENT_WIDTH_EMU = Math.round(6.5 * EMU_PER_INCH);

export type DocxBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string; level: 1 | 2 }
  | { type: 'pageBreak' }
  /** A rendered page picture, sized in pixels for aspect-ratio maths. */
  | { type: 'image'; data: Uint8Array; width: number; height: number };

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Strips characters that are not valid in XML 1.0 before embedding. */
function cleanXml(text: string): string {
  return text.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g, '');
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${cleanXml(escapeXml(text))}</w:t></w:r></w:p>`;
}

function heading(text: string, level: 1 | 2): string {
  return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t xml:space="preserve">${cleanXml(escapeXml(text))}</w:t></w:r></w:p>`;
}

function picture(relId: string, id: number, name: string, width: number, height: number): string {
  const ratio = width > 0 && height > 0 ? height / width : 1.4;
  const cx = CONTENT_WIDTH_EMU;
  const cy = Math.max(1, Math.round(cx * ratio));
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${id}" name="Picture ${id}"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic>' +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p>';
}

export function buildDocx(blocks: DocxBlock[], title: string): Uint8Array {
  const media: { name: string; data: Uint8Array }[] = [];
  const imageRels: string[] = [];
  let drawingId = 1;

  const body = blocks
    .map((block) => {
      if (block.type === 'pageBreak') {
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      }
      if (block.type === 'heading') {
        return heading(block.text, block.level);
      }
      if (block.type === 'image') {
        const index = media.length + 1;
        const name = `image${index}.png`;
        const relId = `rIdImg${index}`;
        media.push({ name, data: block.data });
        imageRels.push(
          `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`,
        );
        const xml = picture(relId, drawingId++, name, block.width, block.height);
        return xml;
      }
      return paragraph(block.text);
    })
    .join('');

  const documentXml =
    XML_DECL +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<w:body>${body}</w:body>` +
    '</w:document>';

  const hasImages = media.length > 0;
  const contentTypes =
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (hasImages ? '<Default Extension="png" ContentType="image/png"/>' : '') +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  const rels =
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>';

  const documentRels =
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    imageRels.join('') +
    '</Relationships>';

  const styles =
    XML_DECL +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
    '</w:styles>';

  const now = new Date().toISOString();
  const coreProps =
    XML_DECL +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
    '</cp:coreProperties>';

  const appProps =
    XML_DECL +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
    '<Application>PDF Toolbox</Application>' +
    '</Properties>';

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    'word/document.xml': strToU8(documentXml),
    'word/_rels/document.xml.rels': strToU8(documentRels),
    'word/styles.xml': strToU8(styles),
    'docProps/core.xml': strToU8(coreProps),
    'docProps/app.xml': strToU8(appProps),
  };
  for (const item of media) {
    files[`word/media/${item.name}`] = item.data;
  }

  return zipSync(files, { level: 6 });
}
