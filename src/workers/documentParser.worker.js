import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

self.onmessage = async (e) => {
  const { fileType, arrayBuffer } = e.data;
  
  try {
    if (fileType === 'docx') {
      const result = await mammoth.convertToHtml({ arrayBuffer });
      self.postMessage({ success: true, html: result.value || '' });
    } else if (fileType === 'xlsx' || fileType === 'xls') {
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Instead of HTML, convert to JSON for virtual table rendering
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (jsonData.length === 0) {
        self.postMessage({ success: true, columns: [], data: [] });
        return;
      }
      
      // Assume first row is header if data is large enough, or just use indices as headers
      const headers = jsonData[0] || [];
      const columns = headers.map((col, index) => ({
        title: col ? String(col) : `Column ${index + 1}`,
        dataIndex: index,
        key: index,
        width: 150
      }));
      
      const tableData = jsonData.slice(1).map((row, rowIndex) => {
        const rowData = { key: rowIndex };
        headers.forEach((_, colIndex) => {
          rowData[colIndex] = row[colIndex] !== undefined ? String(row[colIndex]) : '';
        });
        return rowData;
      });

      self.postMessage({ success: true, columns, data: tableData });
    } else {
      self.postMessage({ success: false, error: 'Unsupported file type in worker' });
    }
  } catch (error) {
    self.postMessage({ success: false, error: error.message });
  }
};