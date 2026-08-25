function safeSheetName(name) {
  return String(name || 'Dados')
    .replace(/[\\/?*[\]:]/g, ' ')
    .slice(0, 31)
    .trim() || 'Dados';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function exportRowsWorkbook(sheets, filename) {
  const ExcelModule = await import('exceljs');
  const ExcelJS = ExcelModule.default || ExcelModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Radar Jira Antlia';
  workbook.created = new Date();

  sheets.forEach(({ name, rows }) => {
    const worksheet = workbook.addWorksheet(safeSheetName(name));
    const data = Array.isArray(rows) ? rows : [];
    const headers = Array.from(data.reduce((set, row) => {
      Object.keys(row || {}).forEach(key => set.add(key));
      return set;
    }, new Set()));

    if (!headers.length) {
      worksheet.addRow(['Sem dados']);
      return;
    }

    worksheet.addRow(headers);
    data.forEach(row => worksheet.addRow(headers.map(header => row?.[header] ?? '')));
    worksheet.columns.forEach((column, index) => {
      const header = headers[index] || '';
      const maxLength = Math.max(
        header.length,
        ...data.map(row => String(row?.[header] ?? '').length)
      );
      column.width = Math.min(Math.max(maxLength + 2, 12), 60);
    });
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }), filename);
}
