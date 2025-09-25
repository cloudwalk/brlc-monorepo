import * as fs from "fs";
import * as path from "path";

// Script parameters

const FILE_TO_UPDATE = process.env.SP_FILE_TO_UPDATE ?? ".cursor/rules/solidity-example-project.mdc";
const CONTRACTS_DIR = process.env.SP_CONTRACTS_DIR ?? "./contracts";
const SECTION_START_STRING = process.env.SP_SECTION_START_STRING ?? "# 1. Example Project";
const SECTION_INITIAL_NUMBER = parseInt(process.env.SP_INITIAL_NUMBER ?? "1");
const INDENT_STRING = process.env.SP_INDENT_STRING ?? "  ";

interface FileStructure {
  name: string;
  isDirectory: boolean;
  children?: FileStructure[];
  content?: string;
}

function scanDirectory(dirPath: string): FileStructure {
  const name = path.basename(dirPath);
  const structure: FileStructure = {
    name,
    isDirectory: true,
    children: [],
  };

  const items = fs.readdirSync(dirPath).sort();

  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      structure.children?.push(scanDirectory(fullPath));
    } else {
      structure.children?.push({
        name: item,
        isDirectory: false,
        content: fs.readFileSync(fullPath, "utf8"),
      });
    }
  }

  return structure;
}

function generateFileStructureDoc(structure: FileStructure, level = 0): string {
  let doc = "";
  const indent = INDENT_STRING.repeat(level);

  if (level === 0) {
    doc += "## " + SECTION_INITIAL_NUMBER + ".1 File Structure\n\n";
  }

  if (structure.isDirectory) {
    doc += `${indent}* \`${structure.name}/\`\n`;
    if (structure.children) {
      structure.children.forEach((child) => {
        doc += generateFileStructureDoc(child, level + 1);
      });
    }
  } else {
    doc += `${indent}* \`${structure.name}\`\n`;
  }

  return doc;
}

function generateFileContentDoc(structure: FileStructure): string {
  let doc = "## " + SECTION_INITIAL_NUMBER + ".2 Project Files\n\n";

  function processFiles(node: FileStructure, currentPath = "") {
    if (node.isDirectory) {
      const newPath = currentPath ? `${currentPath}/${node.name}` : node.name;

      if (node.children) {
        doc += `### Directory \`${newPath}/\`\n\n`;
        node.children.forEach(child => processFiles(child, newPath));
      }
    } else if (node.content) {
      doc += `#### File \`${currentPath}/${node.name}\`\n\n`;
      doc += "```solidity\n";
      doc += node.content;
      doc += "```\n\n";
    }
  }

  processFiles(structure);
  return doc;
}

function main(): void {
  const fileContentToUpdate = fs.readFileSync(FILE_TO_UPDATE, "utf8");
  const structure = scanDirectory(CONTRACTS_DIR);
  const startSymbol = fileContentToUpdate.indexOf(SECTION_START_STRING);
  if (startSymbol < 0) {
    throw Error(
      `The example project section has not been found in the file to update. ` +
      `File: "${FILE_TO_UPDATE}". Section start string: "${SECTION_START_STRING}"`,
    );
  }

  let documentation = fileContentToUpdate.slice(0, startSymbol + SECTION_START_STRING.length);
  documentation += "\n\n";
  documentation += generateFileStructureDoc(structure);
  documentation += "\n\n";
  documentation += generateFileContentDoc(structure);
  documentation = documentation.slice(0, -1); // Remove last `\n`.

  fs.writeFileSync(FILE_TO_UPDATE, documentation);
}

main();
