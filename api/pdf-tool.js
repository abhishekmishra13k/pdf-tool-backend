import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import libre from 'libreoffice-convert';
import Tesseract from 'tesseract.js';

const execAsync = promisify(exec);
const libreConvert = promisify(libre.convert);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const fields = req.body;
  const files = req.files;

  const action = fields.action;
  const watermarkText = fields.watermark || '';
  const uploadedFiles = Array.isArray(files.files) ? files.files : [files.files];

  const buffers = await Promise.all(
    uploadedFiles.map(file => fs.promises.readFile(file.filepath))
  );

  let pdfDoc;
  try {
    switch (action) {
      case 'merge': {
        pdfDoc = await PDFDocument.create();
        for (const buffer of buffers) {
          try {
            const pdf = await PDFDocument.load(buffer);
            const pages = await pdf.copyPages(pdf, pdf.getPageIndices());
            pages.forEach(page => pdfDoc.addPage(page));
          } catch (e) {
            console.log('Skipping non-PDF file');
          }
        }
        const mergedPdfBytes = await pdfDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        return res.send(Buffer.from(mergedPdfBytes));
      }

      case 'compress': {
        const inputPath = uploadedFiles[0].filepath;
        const outputPath = path.join(process.cwd(), 'tmp', `compressed_${Date.now()}.pdf`);
        await execAsync(`gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dQUIET -dBATCH -sOutputFile=${outputPath} ${inputPath}`);
        const compressed = await fs.promises.readFile(outputPath);
        res.setHeader('Content-Type', 'application/pdf');
        return res.send(compressed);
      }

      case 'convert': {
        const convertedPdfs = await Promise.all(uploadedFiles.map(async (file) => {
          const ext = path.extname(file.originalFilename).toLowerCase();
          const buffer = await fs.promises.readFile(file.filepath);

          if (['.jpg', '.jpeg', '.png'].includes(ext)) {
            return await sharp(buffer).pdf().toBuffer();
          } else if (ext === '.docx') {
            return await libreConvert(buffer, '.pdf', undefined);
          } else if (ext === '.pdf') {
            return buffer;
          } else {
            throw new Error(`Unsupported file type: ${ext}`);
          }
        }));

        pdfDoc = await PDFDocument.create();
        for (const pdfBuf of convertedPdfs) {
          const pdf = await PDFDocument.load(pdfBuf);
          const pages = await pdfDoc.copyPages(pdf, pdf.getPageIndices());
          pages.forEach(page => pdfDoc.addPage(page));
        }
        const finalPdf = await pdfDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        return res.send(Buffer.from(finalPdf));
      }

      case 'watermark': {
        const pdf = await PDFDocument.load(buffers[0]);
        const pages = pdf.getPages();
        for (const page of pages) {
          page.drawText(watermarkText, {
            x: 50,
            y: 50,
            size: 24,
            color: rgb(0.95, 0.1, 0.1),
            opacity: 0.5
          });
        }
        const watermarked = await pdf.save();
        res.setHeader('Content-Type', 'application/pdf');
        return res.send(Buffer.from(watermarked));
      }

      case 'ocr': {
        const imgBuffer = buffers[0];
        const result = await Tesseract.recognize(imgBuffer, 'eng');
        return res.status(200).json({ text: result.data.text });
      }

      case 'split': {
        const pdf = await PDFDocument.load(buffers[0]);
        const pages = pdf.getPages();
        const individualBuffers = await Promise.all(
          pages.map(async (page, idx) => {
            const newPdf = await PDFDocument.create();
            const [copied] = await newPdf.copyPages(pdf, [idx]);
            newPdf.addPage(copied);
            return newPdf.save();
          })
        );

        const zip = require('jszip')();
        individualBuffers.forEach((buf, i) => zip.file(`page_${i + 1}.pdf`, buf));
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=\"split_pages.zip\"');
        return res.send(zipBuffer);
      }

      case 'rotate': {
        const pdf = await PDFDocument.load(buffers[0]);
        const pages = pdf.getPages();
        pages.forEach((page) => {
          page.setRotation(degrees(90));
        });
        const rotated = await pdf.save();
        res.setHeader('Content-Type', 'application/pdf');
        return res.send(Buffer.from(rotated));
      }

      default:
        return res.status(400).json({ message: 'Invalid action' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
