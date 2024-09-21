import React, { useState } from 'react';
import Papa from 'papaparse';
import './ReconciliationTool.css'; // Import the CSS file
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  Container,
  Typography,
  Button,
  Box,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import { CSVLink } from 'react-csv';

const parseDate = (dateString) => {
  if (dateString.includes('/')) {
    // Invoice date format: DD/MM/YY HH:MM
    const [date, time] = dateString.split(' ');
    const [day, month, year] = date.split('/');
    const [hour, minute] = time.split(':');
    return new Date(`20${year}`, month - 1, day, hour, minute);
  } else {
    // Payment date format: YYYY-MM-DD HH:MM:SS
    return new Date(dateString.replace(' ', 'T'));
  }
};

const formatAmount = (amount) => {
  return parseFloat(amount).toFixed(2);
};

const convertToCSV = (data) => {
  const array = [Object.keys(data[0])].concat(data);

  return array
    .map((row) => {
      return Object.values(row)
        .map((value) => {
          // Handle null or undefined values
          const safeValue = value !== null && value !== undefined ? value : '';
          // Escape double quotes
          const escapedValue = `${safeValue}`.replace(/"/g, '""');
          // Wrap in double quotes if needed
          if (escapedValue.search(/("|,|\n)/g) >= 0) {
            return `"${escapedValue}"`;
          } else {
            return escapedValue;
          }
        })
        .join(',');
    })
    .join('\n');
};

const matchTransactions = (invoices, payments, timeWindowHours = 6) => {
  const exactMatches = [];
  const amountOnlyMatches = [];
  let unmatched_invoices = [...invoices];
  let unmatched_payments = [...payments];

  // Create maps for quick look-up
  const invoiceMap = new Map();
  unmatched_invoices.forEach((invoice) => {
    const amount = parseFloat(invoice.AMOUNT);
    const key = amount.toFixed(2);
    if (!invoiceMap.has(key)) {
      invoiceMap.set(key, []);
    }
    invoiceMap.get(key).push(invoice);
  });

  // First pass - exact matches
  unmatched_payments.forEach((payment, index) => {
    if (payment.Status === 'FAILURE') return;

    const paymentAmount = parseFloat(payment.Amount).toFixed(2);
    const potentialInvoices = invoiceMap.get(paymentAmount);

    if (potentialInvoices && potentialInvoices.length > 0) {
      const paymentTime = parseDate(payment.Transaction_Date);

      const matchedInvoiceIndex = potentialInvoices.findIndex((invoice) => {
        const invoiceTime = parseDate(invoice.TIMESTAMP);
        return (
          Math.abs(paymentTime - invoiceTime) <= timeWindowHours * 60 * 60 * 1000
        );
      });

      if (matchedInvoiceIndex !== -1) {
        const matchedInvoice = potentialInvoices[matchedInvoiceIndex];
        exactMatches.push({
          payment,
          invoice: matchedInvoice,
          matchType: 'Exact Match',
        });
        potentialInvoices.splice(matchedInvoiceIndex, 1);
        unmatched_payments[index] = null; // Mark for removal
      }
    }
  });

  // Remove matched payments
  unmatched_payments = unmatched_payments.filter((payment) => payment !== null);

  // Second pass - amount only matches
  unmatched_payments.forEach((payment, index) => {
    if (payment.Status === 'FAILURE') return;

    const paymentAmount = parseFloat(payment.Amount).toFixed(2);
    const potentialInvoices = invoiceMap.get(paymentAmount);

    if (potentialInvoices && potentialInvoices.length > 0) {
      // Match on amount only
      const matchedInvoice = potentialInvoices.shift(); // Take the first invoice
      amountOnlyMatches.push({
        payment,
        invoice: matchedInvoice,
        matchType: 'Amount Match Only',
      });
      unmatched_payments[index] = null; // Mark for removal
    }
  });

  // Remove matched payments
  unmatched_payments = unmatched_payments.filter((payment) => payment !== null);

  // Collect unmatched invoices from invoiceMap
  unmatched_invoices = [];
  invoiceMap.forEach((invoices) => {
    unmatched_invoices = unmatched_invoices.concat(invoices);
  });

  // Combine and sort matches
  const allMatches = [...exactMatches, ...amountOnlyMatches].sort((a, b) =>
    a.invoice['VOUCHER NO'].localeCompare(b.invoice['VOUCHER NO'])
  );

  // Filter out FAILURE status payments from unmatched_payments
  unmatched_payments = unmatched_payments.filter(
    (payment) => payment.Status !== 'FAILURE'
  );

  return {
    matched: allMatches,
    unmatched_invoices,
    unmatched_payments,
    exactMatchCount: exactMatches.length,
    amountOnlyMatchCount: amountOnlyMatches.length,
  };
};

const TransactionTable = ({ data, type }) => {
  const renderTableContent = () => {
    switch (type) {
      case 'matched':
        return data.map((item, index) => (
          <TableRow key={index}>
            <TableCell>{item.invoice['VOUCHER NO']}</TableCell>
            <TableCell>{item.invoice.TIMESTAMP}</TableCell>
            <TableCell>{formatAmount(item.invoice.AMOUNT)}</TableCell>
            <TableCell>{item.payment.Transaction_Date}</TableCell>
            <TableCell>{formatAmount(item.payment.Amount)}</TableCell>
            <TableCell>{item.payment.Payment_Mode}</TableCell>
            <TableCell>{item.payment.Customer_VPA}</TableCell>
            <TableCell>{item.matchType}</TableCell>
          </TableRow>
        ));
      case 'unmatched_invoices':
        return data.map((invoice, index) => (
          <TableRow key={index}>
            <TableCell>{invoice['VOUCHER NO']}</TableCell>
            <TableCell>{invoice.TIMESTAMP}</TableCell>
            <TableCell>{formatAmount(invoice.AMOUNT)}</TableCell>
            <TableCell>{invoice['PARTY&ADDRESS']}</TableCell>
          </TableRow>
        ));
      case 'unmatched_payments':
        return data.map((payment, index) => (
          <TableRow key={index}>
            <TableCell>{payment.Transaction_Date}</TableCell>
            <TableCell>{formatAmount(payment.Amount)}</TableCell>
            <TableCell>{payment.Payment_Mode}</TableCell>
            <TableCell>{payment.Customer_VPA}</TableCell>
          </TableRow>
        ));
      default:
        return null;
    }
  };

  const renderTableHeaders = () => {
    switch (type) {
      case 'matched':
        return (
          <TableRow>
            <TableCell>Invoice No</TableCell>
            <TableCell>Invoice Date</TableCell>
            <TableCell>Invoice Amount</TableCell>
            <TableCell>Payment Date</TableCell>
            <TableCell>Payment Amount</TableCell>
            <TableCell>Payment Mode</TableCell>
            <TableCell>Customer VPA</TableCell>
            <TableCell>Match Type</TableCell>
          </TableRow>
        );
      case 'unmatched_invoices':
        return (
          <TableRow>
            <TableCell>Voucher No</TableCell>
            <TableCell>Timestamp</TableCell>
            <TableCell>Amount</TableCell>
            <TableCell>Party & Address</TableCell>
          </TableRow>
        );
      case 'unmatched_payments':
        return (
          <TableRow>
            <TableCell>Transaction Date</TableCell>
            <TableCell>Amount</TableCell>
            <TableCell>Payment Mode</TableCell>
            <TableCell>Customer VPA</TableCell>
          </TableRow>
        );
      default:
        return null;
    }
  };

  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>{renderTableHeaders()}</TableHead>
        <TableBody>{renderTableContent()}</TableBody>
      </Table>
    </TableContainer>
  );
};

const ReconciliationTool = () => {
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleFileUpload = (event, setterFunction) => {
    const file = event.target.files[0];
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: function (results) {
        setterFunction(results.data);
      },
    });
  };

  const performReconciliation = () => {
    setLoading(true);
    setTimeout(() => {
      const {
        matched,
        unmatched_invoices,
        unmatched_payments,
        exactMatchCount,
        amountOnlyMatchCount,
      } = matchTransactions(invoices, payments);
      setResults({
        matched,
        unmatched_invoices,
        unmatched_payments,
        exactMatchCount,
        amountOnlyMatchCount,
      });
      setLoading(false);
    }, 100); // Simulate async processing
  };

  // Function to export all data to PDF
  const exportAllDataToPDF = () => {
    if (results) {
      const doc = new jsPDF();

      let yPosition = 10; // Starting vertical position

      // Matched Transactions
      if (results.matched.length > 0) {
        doc.text('Matched Transactions', 14, yPosition);
        yPosition += 6;

        const matchedHeaders = [
          'Invoice No',
          'Invoice Date',
          'Invoice Amount',
          'Payment Date',
          'Payment Amount',
          'Payment Mode',
          'Customer VPA',
          'Match Type',
        ];

        const matchedData = results.matched.map((item) => [
          item.invoice['VOUCHER NO'],
          item.invoice.TIMESTAMP,
          item.invoice.AMOUNT,
          item.payment.Transaction_Date,
          item.payment.Amount,
          item.payment.Payment_Mode,
          item.payment.Customer_VPA,
          item.matchType,
        ]);

        doc.autoTable({
          head: [matchedHeaders],
          body: matchedData,
          startY: yPosition,
          theme: 'striped',
          styles: { fontSize: 8 },
        });

        yPosition = doc.lastAutoTable.finalY + 10;
      }

      // Unmatched Invoices
      if (results.unmatched_invoices.length > 0) {
        doc.text('Unmatched Invoices', 14, yPosition);
        yPosition += 6;

        const unmatchedInvoicesHeaders = ['Voucher No', 'Timestamp', 'Amount', 'Party & Address'];

        const unmatchedInvoicesData = results.unmatched_invoices.map((invoice) => [
          invoice['VOUCHER NO'],
          invoice.TIMESTAMP,
          invoice.AMOUNT,
          invoice['PARTY&ADDRESS'],
        ]);

        doc.autoTable({
          head: [unmatchedInvoicesHeaders],
          body: unmatchedInvoicesData,
          startY: yPosition,
          theme: 'striped',
          styles: { fontSize: 8 },
        });

        yPosition = doc.lastAutoTable.finalY + 10;
      }

      // Unmatched Payments
      if (results.unmatched_payments.length > 0) {
        doc.text('Unmatched Payments', 14, yPosition);
        yPosition += 6;

        const unmatchedPaymentsHeaders = ['Transaction Date', 'Amount', 'Payment Mode', 'Customer VPA'];

        const unmatchedPaymentsData = results.unmatched_payments.map((payment) => [
          payment.Transaction_Date,
          payment.Amount,
          payment.Payment_Mode,
          payment.Customer_VPA,
        ]);

        doc.autoTable({
          head: [unmatchedPaymentsHeaders],
          body: unmatchedPaymentsData,
          startY: yPosition,
          theme: 'striped',
          styles: { fontSize: 8 },
        });
      }

      // Save the PDF
      doc.save('reconciliation_report.pdf');
    } else {
      alert('No data to export.');
    }
  };

  // Existing export functions (exportCSV, exportMatchedTransactions, etc.) remain the same

  // General function to trigger CSV download
  const exportCSV = (data, filename) => {
    const csvContent = convertToCSV(data);
    const blob = new Blob([csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);

    // Create a temporary link to trigger the download
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Function to export matched transactions
  const exportMatchedTransactions = () => {
    if (results && results.matched.length > 0) {
      const dataToExport = results.matched.map((item) => ({
        'Invoice No': item.invoice['VOUCHER NO'],
        'Invoice Date': item.invoice.TIMESTAMP,
        'Invoice Amount': item.invoice.AMOUNT,
        'Payment Date': item.payment.Transaction_Date,
        'Payment Amount': item.payment.Amount,
        'Payment Mode': item.payment.Payment_Mode,
        'Customer VPA': item.payment.Customer_VPA,
        'Match Type': item.matchType,
      }));
      exportCSV(dataToExport, 'matched_transactions.csv');
    } else {
      alert('No matched transactions to export.');
    }
  };

  // Function to export unmatched invoices
  const exportUnmatchedInvoices = () => {
    if (results && results.unmatched_invoices.length > 0) {
      exportCSV(results.unmatched_invoices, 'unmatched_invoices.csv');
    } else {
      alert('No unmatched invoices to export.');
    }
  };

  // Function to export unmatched payments
  const exportUnmatchedPayments = () => {
    if (results && results.unmatched_payments.length > 0) {
      exportCSV(results.unmatched_payments, 'unmatched_payments.csv');
    } else {
      alert('No unmatched payments to export.');
    }
  };

  // Function to export all data in one CSV file
  const exportAllData = () => {
    if (results) {
      const dataToExport = [];

      // Export matched transactions
      results.matched.forEach((item) => {
        dataToExport.push({
          'Record Type': 'Matched Transaction',
          'Invoice No': item.invoice['VOUCHER NO'],
          'Invoice Date': item.invoice.TIMESTAMP,
          'Invoice Amount': item.invoice.AMOUNT,
          'Payment Date': item.payment.Transaction_Date,
          'Payment Amount': item.payment.Amount,
          'Payment Mode': item.payment.Payment_Mode,
          'Customer VPA': item.payment.Customer_VPA,
          'Match Type': item.matchType,
        });
      });

      // Export unmatched invoices
      results.unmatched_invoices.forEach((invoice) => {
        dataToExport.push({
          'Record Type': 'Unmatched Invoice',
          'Voucher No': invoice['VOUCHER NO'],
          'Timestamp': invoice.TIMESTAMP,
          'Amount': invoice.AMOUNT,
          'Party & Address': invoice['PARTY&ADDRESS'],
        });
      });

      // Export unmatched payments
      results.unmatched_payments.forEach((payment) => {
        dataToExport.push({
          'Record Type': 'Unmatched Payment',
          'Transaction Date': payment.Transaction_Date,
          'Amount': payment.Amount,
          'Payment Mode': payment.Payment_Mode,
          'Customer VPA': payment.Customer_VPA,
        });
      });

      exportCSV(dataToExport, 'reconciliation_results.csv');
    } else {
      alert('No data to export.');
    }
  };

  return (
    <Container maxWidth="lg">
      <Typography variant="h4" component="h1" gutterBottom>
        Reconciliation Tool
      </Typography>

      <Box mb={2}>
        <Typography variant="subtitle1">Upload Invoices CSV:</Typography>
        <Button variant="contained" component="label">
          Choose File
          <input
            type="file"
            hidden
            onChange={(e) => handleFileUpload(e, setInvoices)}
            accept=".csv"
          />
        </Button>
        {invoices.length > 0 && (
          <Typography variant="body2" color="textSecondary">
            {invoices.length} invoices loaded
          </Typography>
        )}
      </Box>

      <Box mb={2}>
        <Typography variant="subtitle1">Upload Payments CSV:</Typography>
        <Button variant="contained" component="label">
          Choose File
          <input
            type="file"
            hidden
            onChange={(e) => handleFileUpload(e, setPayments)}
            accept=".csv"
          />
        </Button>
        {payments.length > 0 && (
          <Typography variant="body2" color="textSecondary">
            {payments.length} payments loaded
          </Typography>
        )}
      </Box>

      <Button
        variant="contained"
        color="primary"
        onClick={performReconciliation}
        disabled={!invoices.length || !payments.length || loading}
        startIcon={loading ? <CircularProgress size={20} /> : null}
      >
        {loading ? 'Processing...' : 'Perform Reconciliation'}
      </Button>

      {results && (
        <Box mt={4}>
          <Typography variant="h5" gutterBottom>
            Results:
          </Typography>
          <Box mb={2} p={2} bgcolor="#f8f9fa">
            <Typography variant="h6">Summary</Typography>
            <Typography>Total Matched transactions: {results.matched.length}</Typography>
            <Typography>- Exact Matches: {results.exactMatchCount}</Typography>
            <Typography>- Amount-Only Matches: {results.amountOnlyMatchCount}</Typography>
            <Typography>Unmatched invoices: {results.unmatched_invoices.length}</Typography>
            <Typography>Unmatched payments: {results.unmatched_payments.length}</Typography>
          </Box>

          <Box mt={4}>
            <Typography variant="h6">Matched Transactions:</Typography>
            <TransactionTable data={results.matched} type="matched" />
          </Box>

          <Box mt={4}>
            <Typography variant="h6">Unmatched Invoices:</Typography>
            <TransactionTable data={results.unmatched_invoices} type="unmatched_invoices" />
          </Box>

          <Box mt={4}>
            <Typography variant="h6">Unmatched Payments:</Typography>
            <TransactionTable data={results.unmatched_payments} type="unmatched_payments" />
          </Box>

          {/* Export Buttons */}
          <Box mt={4}>
            <Typography variant="h6">Export Results:</Typography>
            <Button
              variant="contained"
              color="success"
              onClick={exportMatchedTransactions}
              style={{ marginRight: '10px', marginTop: '10px' }}
            >
              Export Matched Transactions
            </Button>
            <Button
              variant="contained"
              color="info"
              onClick={exportUnmatchedInvoices}
              style={{ marginRight: '10px', marginTop: '10px' }}
            >
              Export Unmatched Invoices
            </Button>
            <Button
              variant="contained"
              color="warning"
              onClick={exportUnmatchedPayments}
              style={{ marginRight: '10px', marginTop: '10px' }}
            >
              Export Unmatched Payments
            </Button>
            <Button
              variant="contained"
              color="secondary"
              onClick={exportAllData}
              style={{ marginRight: '10px', marginTop: '10px' }}
            >
              Export All Data
            </Button>
            <Button
              variant="contained"
              color="secondary"
              onClick={exportAllDataToPDF}
              style={{ marginRight: '10px', marginTop: '10px' }}
            >
              Export All Data to PDF
            </Button>
          </Box>
        </Box>
      )}
    </Container>
  );
};

export default ReconciliationTool;