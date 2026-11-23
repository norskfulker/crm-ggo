import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { format } from 'date-fns';
import Papa from 'papaparse';
import BulkUploadEditor from './BulkUploadEditor';

function Payments() {
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);
  const [formData, setFormData] = useState({
    customer_id: '',
    payments: [
      {
        amount_inr: '',
        date: '01/01/2023',
        utr: '',
        notes: ''
      }
    ]
  });
  const [message, setMessage] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedPayments, setSelectedPayments] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [utrValidation, setUtrValidation] = useState({});
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMoreData, setHasMoreData] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalLoaded, setTotalLoaded] = useState(0);
  
  // New state for grouped view
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'grouped'
  
  // New state for Excel-like table
  const [excelTableData, setExcelTableData] = useState([
    { customer_email: '', amount_inr: '', date: '01/01/2023', utr: '', notes: '' }
  ]);

  // CSV Upload state
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [fileInputRef] = useState(React.createRef());
  
  // Bulk Upload Editor state
  const [showBulkEditor, setShowBulkEditor] = useState(false);
  const [bulkEditorData, setBulkEditorData] = useState([]);
  
  // Missing entries table state
  const [showMissingEntriesTable, setShowMissingEntriesTable] = useState(false);
  const [missingEntriesData, setMissingEntriesData] = useState([]);
  const [missingEntriesLoading, setMissingEntriesLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showExcelTable, setShowExcelTable] = useState(false);
  const [excelCustomerSearch, setExcelCustomerSearch] = useState('');
  const [showExcelCustomerDropdown, setShowExcelCustomerDropdown] = useState(false);
  const [rowCustomerSearches, setRowCustomerSearches] = useState({});
  const [rowCustomerDropdowns, setRowCustomerDropdowns] = useState({});
  
  // Duplicate UTR deletion state
  const [duplicateUtrs, setDuplicateUtrs] = useState([]);
  const [showDuplicateUtrs, setShowDuplicateUtrs] = useState(false);
  const [deletingUtrs, setDeletingUtrs] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.customer-dropdown-container')) {
        setShowCustomerDropdown(false);
      }
      if (!event.target.closest('.excel-customer-dropdown-container')) {
        setShowExcelCustomerDropdown(false);
      }
      // Close all row customer dropdowns when clicking outside
      if (!event.target.closest('.row-customer-dropdown')) {
        setRowCustomerDropdowns({});
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const fetchData = async (loadMore = false) => {
    try {
      if (!loadMore) {
        setLoading(true);
        setCurrentPage(0);
        setTotalLoaded(0);
      } else {
        setIsLoadingMore(true);
      }

      const pageSize = 1000;
      const from = loadMore ? currentPage * pageSize : 0;
      const to = from + pageSize - 1;

      // Fetch payments with customer emails (paginated)
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select(`
          *,
          customers (email)
        `)
        .order('date', { ascending: false })
        .range(from, to);

      if (paymentsError) throw paymentsError;

      // Fetch customers for dropdown (only on initial load)
      if (!loadMore) {
        const { data: customersData, error: customersError } = await supabase
          .from('customers')
          .select('id, email')
          .order('email');

        if (customersError) throw customersError;
        setCustomers(customersData || []);
      }

      // Update payments data
      if (loadMore) {
        setPayments(prev => [...prev, ...(paymentsData || [])]);
        setCurrentPage(prev => prev + 1);
        setTotalLoaded(prev => prev + (paymentsData?.length || 0));
      } else {
        setPayments(paymentsData || []);
        setCurrentPage(1);
        setTotalLoaded(paymentsData?.length || 0);
      }

      // Check if there's more data
      setHasMoreData((paymentsData?.length || 0) === pageSize);

      // Add gap time if loading more data
      if (loadMore && paymentsData?.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second gap
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setMessage('Error fetching data');
    } finally {
      setLoading(false);
      setIsLoadingMore(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate that a customer is selected
      if (!formData.customer_id) {
        setMessage('Please select a customer');
        setLoading(false);
        return;
      }

      if (editingPayment) {
        // Handle single payment edit
        // Convert date to YYYY-MM-DD format for database
        let dbDate = formData.payments[0].date;
        
        // Handle DD-MMM-YY format (e.g., "30-Aug-22")
        const ddMmmYyRegex = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
        const ddMmmYyMatch = formData.payments[0].date.match(ddMmmYyRegex);
        
        if (ddMmmYyMatch) {
          const [, day, month, year] = ddMmmYyMatch;
          const monthNames = {
            'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
            'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
            'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
          };
          
          const monthNum = monthNames[month.toLowerCase()];
          if (monthNum) {
            const fullYear = `20${year}`;
            const paddedDay = day.padStart(2, '0');
            dbDate = `${fullYear}-${monthNum}-${paddedDay}`;
          }
        } else if (formData.payments[0].date.includes('/')) {
          // Handle DD/MM/YYYY format
          const [day, month, year] = formData.payments[0].date.split('/');
          dbDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        
        const paymentData = {
          customer_id: formData.customer_id,
          amount_inr: parseFloat(formData.payments[0].amount_inr),
          date: dbDate,
          utr: formData.payments[0].utr || null,
          notes: formData.payments[0].notes
        };

        const { error } = await supabase
          .from('payments')
          .update(paymentData)
          .eq('id', editingPayment.id);

        if (error) throw error;
        setMessage('Payment updated successfully');
      } else {
        // Handle multiple payments insert
        const validPayments = formData.payments.filter(payment => 
          payment.amount_inr && payment.amount_inr > 0 && validateDate(payment.date)
        );

        if (validPayments.length === 0) {
          setMessage('Please add at least one payment with a valid amount');
          setLoading(false);
          return;
        }

        // Check for UTR duplicates
        const utrsToCheck = validPayments
          .map(payment => payment.utr)
          .filter(utr => utr && utr.trim() !== '');

        if (utrsToCheck.length > 0) {
          // Check for duplicates in payments table
          const { data: existingPayments, error: paymentsCheckError } = await supabase
            .from('payments')
            .select('utr')
            .in('utr', utrsToCheck);

          if (paymentsCheckError) throw paymentsCheckError;

                   // Check for duplicates in payouts table (using notes field as UTR)
         const { data: existingPayouts, error: payoutsCheckError } = await supabase
           .from('payouts')
           .select('notes')
           .in('notes', utrsToCheck);

          if (payoutsCheckError) throw payoutsCheckError;

                   const existingUtrs = [
           ...(existingPayments || []).map(p => p.utr),
           ...(existingPayouts || []).map(p => p.notes)
         ];

          const duplicateUtrs = utrsToCheck.filter(utr => existingUtrs.includes(utr));

          if (duplicateUtrs.length > 0) {
            setMessage(`UTR(s) already exist: ${duplicateUtrs.join(', ')}. Please use a different UTR.`);
            setLoading(false);
            return;
          }
        }

        const paymentsToInsert = validPayments.map(payment => {
          // Convert date to YYYY-MM-DD format for database
          let dbDate = payment.date;
          
          // Handle DD-MMM-YY format (e.g., "30-Aug-22")
          const ddMmmYyRegex = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
          const ddMmmYyMatch = payment.date.match(ddMmmYyRegex);
          
          if (ddMmmYyMatch) {
            const [, day, month, year] = ddMmmYyMatch;
            const monthNames = {
              'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
              'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
              'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
            };
            
            const monthNum = monthNames[month.toLowerCase()];
            if (monthNum) {
              const fullYear = `20${year}`;
              const paddedDay = day.padStart(2, '0');
              dbDate = `${fullYear}-${monthNum}-${paddedDay}`;
            }
          } else if (payment.date.includes('/')) {
            // Handle DD/MM/YYYY format
            const [day, month, year] = payment.date.split('/');
            dbDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          }
          
          return {
            customer_id: formData.customer_id,
            amount_inr: parseFloat(payment.amount_inr),
            date: dbDate,
            utr: payment.utr || null,
            notes: payment.notes
          };
        });

        const { error } = await supabase
          .from('payments')
          .insert(paymentsToInsert);

        if (error) throw error;
        setMessage(`Successfully added ${validPayments.length} payment(s)`);
      }

      setFormData({
        customer_id: '',
        payments: [
          {
            amount_inr: '',
            date: '01/01/2023',
            utr: '',
            notes: ''
          }
        ]
      });
      setCustomerSearch('');
      setShowForm(false);
      setEditingPayment(null);
      fetchData();
      
      // Refresh customers list to update payment totals
      if (window.refreshCustomersList) {
        window.refreshCustomersList();
      }
    } catch (error) {
      console.error('Error saving payment:', error);
      setMessage('Error saving payment');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (payment) => {
    setEditingPayment(payment);
    setFormData({
      customer_id: payment.customer_id,
      payments: [
        {
          amount_inr: payment.amount_inr.toString(),
          date: format(new Date(payment.date), 'dd/MM/yyyy'),
          utr: payment.utr || '',
          notes: payment.notes || ''
        }
      ]
    });
    setCustomerSearch(payment.customers?.email || '');
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this payment?')) return;

    try {
      const { error } = await supabase
        .from('payments')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setMessage('Payment deleted successfully');
      fetchData();
      
      // Refresh customers list to update payment totals
      if (window.refreshCustomersList) {
        window.refreshCustomersList();
      }
    } catch (error) {
      console.error('Error deleting payment:', error);
      setMessage('Error deleting payment');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingPayment(null);
    setFormData({
      customer_id: '',
      payments: [
        {
          amount_inr: '',
          date: '2023-01-01',
          utr: '',
          notes: ''
        }
      ]
    });
    setCustomerSearch('');
    setShowCustomerDropdown(false);
  };

  const filteredCustomers = customers.filter(customer =>
    customer.email.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const handleCustomerSelect = (customer) => {
    setFormData({ ...formData, customer_id: customer.id });
    setCustomerSearch(customer.email);
    setShowCustomerDropdown(false);
  };

  const getSelectedCustomerEmail = () => {
    const customer = customers.find(c => c.id === formData.customer_id);
    return customer ? customer.email : '';
  };

  // Auto-fix date format to DD/MM/YYYY
  const autoFixDateFormat = (dateString) => {
    if (!dateString || dateString.trim() === '') return dateString;
    
    const trimmedDate = dateString.trim();
    
    // Handle DD-MMM-YY format (e.g., "30-Aug-22")
    const ddMmmYyRegex = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
    const ddMmmYyMatch = trimmedDate.match(ddMmmYyRegex);
    
    if (ddMmmYyMatch) {
      const [, day, month, year] = ddMmmYyMatch;
      const monthNames = {
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
        'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
        'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
      };
      
      const monthNum = monthNames[month.toLowerCase()];
      if (monthNum) {
        const fullYear = `20${year}`;
        const paddedDay = day.padStart(2, '0');
        return `${paddedDay}/${monthNum}/${fullYear}`;
      }
    }
    
    // Handle YYYY-MM-DD format (e.g., "2023-12-04")
    const ymdRegex = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
    const ymdMatch = trimmedDate.match(ymdRegex);
    
    if (ymdMatch) {
      const [, year, month, day] = ymdMatch;
      const paddedDay = day.padStart(2, '0');
      const paddedMonth = month.padStart(2, '0');
      return `${paddedDay}/${paddedMonth}/${year}`;
    }
    
    // Handle M/D/YYYY or D/M/YYYY format (e.g., "12/4/2023", "9/1/2023")
    // We'll assume it's M/D/YYYY format as that's more common in US/Excel
    const mdyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const mdyMatch = trimmedDate.match(mdyRegex);
    
    if (mdyMatch) {
      const [, first, second, year] = mdyMatch;
      const firstNum = parseInt(first);
      const secondNum = parseInt(second);
      
      // If first number is > 12, it's likely a day (D/M/YYYY)
      // If second number is > 12, it's likely M/D/YYYY
      // Default to M/D/YYYY format
      let month, day;
      
      if (firstNum > 12 && secondNum <= 12) {
        // D/M/YYYY format
        day = first;
        month = second;
      } else {
        // M/D/YYYY format (default)
        month = first;
        day = second;
      }
      
      const paddedDay = day.padStart(2, '0');
      const paddedMonth = month.padStart(2, '0');
      return `${paddedDay}/${paddedMonth}/${year}`;
    }
    
    // If it's already in DD/MM/YYYY format, just ensure proper padding
    const ddmmRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const ddmmMatch = trimmedDate.match(ddmmRegex);
    
    if (ddmmMatch) {
      const [, day, month, year] = ddmmMatch;
      const paddedDay = day.padStart(2, '0');
      const paddedMonth = month.padStart(2, '0');
      return `${paddedDay}/${paddedMonth}/${year}`;
    }
    
    // Return original if no pattern matches
    return trimmedDate;
  };

  // Validate date format and range
  const validateDate = (dateString) => {
    if (!dateString || dateString.trim() === '') return false;
    
    // Handle DD-MMM-YY format (e.g., "30-Aug-22")
    const ddMmmYyRegex = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
    const ddMmmYyMatch = dateString.match(ddMmmYyRegex);
    
    if (ddMmmYyMatch) {
      const [, day, month, year] = ddMmmYyMatch;
      const monthNames = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3,
        'may': 4, 'jun': 5, 'jul': 6, 'aug': 7,
        'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
      };
      
      const monthNum = monthNames[month.toLowerCase()];
      if (monthNum === undefined) return false;
      
      const fullYear = 2000 + parseInt(year);
      const date = new Date(fullYear, monthNum, parseInt(day));
      
      return date.getFullYear() === fullYear && 
             date.getMonth() === monthNum && 
             date.getDate() === parseInt(day) &&
             fullYear >= 2022 && fullYear <= 2023;
    }
    
    // Check if it matches DD/MM/YYYY format
    const dateRegex = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(202[23])$/;
    if (!dateRegex.test(dateString)) return false;
    
    // Additional validation for valid dates
    const [day, month, year] = dateString.split('/').map(Number);
    const date = new Date(year, month - 1, day);
    
    return date.getFullYear() === year && 
           date.getMonth() === month - 1 && 
           date.getDate() === day;
  };

  // Live UTR validation function
  const validateUtrLive = async (utr, index) => {
    try {
      // Check for duplicates in payments table
      const { data: existingPayments, error: paymentsCheckError } = await supabase
        .from('payments')
        .select('utr')
        .eq('utr', utr);

      if (paymentsCheckError) throw paymentsCheckError;

      // Check for duplicates in payouts table (using notes field as UTR)
      const { data: existingPayouts, error: payoutsCheckError } = await supabase
        .from('payouts')
        .select('notes')
        .eq('notes', utr);

      if (payoutsCheckError) throw payoutsCheckError;

      const isDuplicate = (existingPayments && existingPayments.length > 0) || 
                         (existingPayouts && existingPayouts.length > 0);

      setUtrValidation(prev => ({
        ...prev,
        [index]: {
          isValid: !isDuplicate,
          message: isDuplicate ? 'UTR already exists in the system' : 'UTR is available'
        }
      }));
    } catch (error) {
      console.error('Error validating UTR:', error);
      setUtrValidation(prev => ({
        ...prev,
        [index]: {
          isValid: false,
          message: 'Error checking UTR availability'
        }
      }));
    }
  };

  const addPaymentRow = () => {
    setFormData({
      ...formData,
      payments: [
        ...formData.payments,
        {
          amount_inr: '',
          date: '01/01/2023',
          utr: '',
          notes: ''
        }
      ]
    });
  };

  const removePaymentRow = (index) => {
    if (formData.payments.length > 1) {
      const newPayments = formData.payments.filter((_, i) => i !== index);
      setFormData({
        ...formData,
        payments: newPayments
      });
    }
  };

  const updatePaymentRow = (index, field, value) => {
    const newPayments = [...formData.payments];
    
    // Special handling for date field to ensure proper DD/MM/YYYY format
    if (field === 'date') {
      let formattedValue = value;
      
      // Handle DD-MMM-YY format (e.g., "30-Aug-22")
      const ddMmmYyRegex = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
      const match = value.match(ddMmmYyRegex);
      
      if (match) {
        const [, day, month, year] = match;
        const monthNames = {
          'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
          'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
          'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
        };
        
        const monthNum = monthNames[month.toLowerCase()];
        if (monthNum) {
          const fullYear = year.length === 2 ? `20${year}` : year;
          const paddedDay = day.padStart(2, '0');
          formattedValue = `${paddedDay}/${monthNum}/${fullYear}`;
        }
      } else {
        // Handle regular DD/MM/YYYY format
        // Remove any non-numeric characters except forward slashes
        let cleanedValue = value.replace(/[^\d/]/g, '');
        
        // Auto-insert slashes at appropriate positions
        if (cleanedValue.length >= 2 && !cleanedValue.includes('/')) {
          cleanedValue = cleanedValue.slice(0, 2) + '/' + cleanedValue.slice(2);
        }
        if (cleanedValue.length >= 5 && cleanedValue.split('/').length === 2) {
          cleanedValue = cleanedValue.slice(0, 5) + '/' + cleanedValue.slice(5);
        }
        
        // Limit to DD/MM/YYYY format (10 characters)
        if (cleanedValue.length > 10) {
          cleanedValue = cleanedValue.slice(0, 10);
        }
        
        formattedValue = cleanedValue;
      }
      
      value = formattedValue;
    }
    
    newPayments[index] = {
      ...newPayments[index],
      [field]: value
    };
    setFormData({
      ...formData,
      payments: newPayments
    });

    // Live UTR validation
    if (field === 'utr' && value.trim()) {
      validateUtrLive(value.trim(), index);
    } else if (field === 'utr' && !value.trim()) {
      // Clear validation state if UTR is empty
      setUtrValidation(prev => ({
        ...prev,
        [index]: { isValid: true, message: '' }
      }));
    }
  };

  // Auto-select customer if email exists
  const handleCustomerEmailChange = (e) => {
    const email = e.target.value;
    setCustomerSearch(email);
    
    // Check if the email exists in customers list
    const existingCustomer = customers.find(customer => 
      customer.email.toLowerCase() === email.toLowerCase()
    );
    
    if (existingCustomer) {
      // Auto-select the customer
      setFormData({ ...formData, customer_id: existingCustomer.id });
      setShowCustomerDropdown(false);
    } else {
      // Clear selection if email doesn't exist
      setFormData({ ...formData, customer_id: '' });
      setShowCustomerDropdown(true);
    }
  };

  const exportToCSV = () => {
    const exportData = payments.map(payment => ({
      'Customer Email': payment.customers?.email || '',
      'Amount (INR)': payment.amount_inr,
      'Date': format(new Date(payment.date), 'dd/MM/yyyy'),
      'UTR': payment.utr || '',
      'Notes': payment.notes || '',
      'Created At': format(new Date(payment.created_at), 'dd/MM/yyyy HH:mm')
    }));

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'payments.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadSampleCSV = () => {
    const sampleData = [
      {
        'Customer Email': 'john.doe@example.com',
        'Amount (INR)': '10000',
        'Date': '01/01/2024',
        'UTR': 'UTR123456789',
        'Notes': 'Sample payment'
      },
      {
        'Customer Email': 'jane.smith@example.com',
        'Amount (INR)': '15000',
        'Date': '02/01/2024',
        'UTR': 'UTR987654321',
        'Notes': 'Another payment'
      },
      {
        'Customer Email': 'bob.johnson@example.com',
        'Amount (INR)': '20000',
        'Date': '03/01/2024',
        'UTR': 'UTR456789123',
        'Notes': 'Third payment'
      }
    ];

    const csv = Papa.unparse(sampleData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'sample_payments.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleMissingEntriesSubmit = async (e) => {
    e.preventDefault();
    setMissingEntriesLoading(true);

    try {
      // Validate data
      const validRows = missingEntriesData.filter(row => 
        row.customer_email && row.amount_inr && row.amount_inr > 0 && validateDate(row.date)
      );

      if (validRows.length === 0) {
        setMessage('Please fix at least one valid payment row with customer and amount');
        setMissingEntriesLoading(false);
        return;
      }

      // Get customer IDs for all emails
      const customerEmails = [...new Set(validRows.map(row => row.customer_email))];
      const { data: customerData, error: customerError } = await supabase
        .from('customers')
        .select('id, email')
        .in('email', customerEmails);

      if (customerError) throw customerError;

      const customerMap = {};
      customerData.forEach(customer => {
        customerMap[customer.email] = customer.id;
      });

      // Check for missing customers
      const missingEmails = customerEmails.filter(email => !customerMap[email]);
      if (missingEmails.length > 0) {
        setMessage(`Customers not found: ${missingEmails.join(', ')}`);
        setMissingEntriesLoading(false);
        return;
      }

      // Check for UTR duplicates
      const utrsToCheck = validRows
        .map(row => row.utr)
        .filter(utr => utr && utr.trim() !== '');

      if (utrsToCheck.length > 0) {
        const { data: existingPayments, error: paymentsCheckError } = await supabase
          .from('payments')
          .select('utr')
          .in('utr', utrsToCheck);

        if (paymentsCheckError) throw paymentsCheckError;

        const { data: existingPayouts, error: payoutsCheckError } = await supabase
          .from('payouts')
          .select('notes')
          .in('notes', utrsToCheck);

        if (payoutsCheckError) throw payoutsCheckError;

        const existingUtrs = [
          ...(existingPayments || []).map(p => p.utr),
          ...(existingPayouts || []).map(p => p.notes)
        ];

        const duplicateUtrs = utrsToCheck.filter(utr => existingUtrs.includes(utr));

        if (duplicateUtrs.length > 0) {
          setMessage(`UTR(s) already exist: ${duplicateUtrs.join(', ')}. Please use a different UTR.`);
          setMissingEntriesLoading(false);
          return;
        }
      }

      // Prepare payments for insertion
      const paymentsToInsert = validRows.map(row => {
        // Convert date to YYYY-MM-DD format for database
        let dbDate = row.date;
        
        // Handle DD-MMM-YY format (e.g., "30-Aug-22")
        const ddMmmYyRegex = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
        const ddMmmYyMatch = row.date.match(ddMmmYyRegex);
        
        if (ddMmmYyMatch) {
          const [, day, month, year] = ddMmmYyMatch;
          const monthNames = {
            'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
            'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
            'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
          };
          
          const monthNum = monthNames[month.toLowerCase()];
          if (monthNum) {
            const fullYear = `20${year}`;
            const paddedDay = day.padStart(2, '0');
            dbDate = `${fullYear}-${monthNum}-${paddedDay}`;
          }
        } else if (row.date.includes('/')) {
          // Handle DD/MM/YYYY format
          const [day, month, year] = row.date.split('/');
          dbDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        
        return {
          customer_id: customerMap[row.customer_email],
          amount_inr: parseFloat(row.amount_inr),
          date: dbDate,
          utr: row.utr,
          notes: row.notes
        };
      });

      const { error } = await supabase
        .from('payments')
        .insert(paymentsToInsert);

      if (error) throw error;
      setMessage(`Successfully added ${validRows.length} corrected payment(s)`);
      
      // Reset form
      setMissingEntriesData([]);
      setShowMissingEntriesTable(false);
      fetchData();
    } catch (error) {
      console.error('Error saving corrected payments:', error);
      setMessage('Error saving corrected payments');
    } finally {
      setMissingEntriesLoading(false);
    }
  };

  const updateMissingEntry = (index, field, value) => {
    const newData = [...missingEntriesData];
    newData[index] = {
      ...newData[index],
      [field]: value
    };
    setMissingEntriesData(newData);
  };

  const removeMissingEntry = (index) => {
    setMissingEntriesData(missingEntriesData.filter((_, i) => i !== index));
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      setMessage('Please select a valid CSV file');
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        if (results.errors.length > 0) {
          console.error('CSV parsing errors:', results.errors);
          const realErrors = results.errors.filter(error => 
            !error.message.includes('Unable to auto-detect delimiting character')
          );
          
          if (realErrors.length > 0) {
            setMessage(`Error parsing CSV file: ${realErrors[0].message || 'Please check the format.'}`);
            return;
          }
        }

        // Check if the CSV has the required columns
        const requiredColumns = ['Customer Email', 'Amount (INR)', 'Date'];
        const missingColumns = requiredColumns.filter(col => !results.data[0] || !results.data[0].hasOwnProperty(col));
        
        if (missingColumns.length > 0) {
          setMessage(`CSV file is missing required columns: ${missingColumns.join(', ')}`);
          return;
        }

        // Filter rows that have required data
        const payments = results.data.filter(row => {
          return row['Customer Email'] && 
                 row['Amount (INR)'] && 
                 row['Date'] &&
                 row['Customer Email'].toString().trim() !== '' &&
                 row['Amount (INR)'].toString().trim() !== '' &&
                 row['Date'].toString().trim() !== '';
        });
        
        if (payments.length === 0) {
          setMessage('No valid payment data found in CSV. Please ensure the file has the required columns with data.');
          return;
        }

        setUploadLoading(true);
        try {
          // Get existing UTRs to check for duplicates
          const { data: existingPayments, error: fetchError } = await supabase
            .from('payments')
            .select('utr')
            .not('utr', 'is', null);

          if (fetchError) throw fetchError;

          const existingUTRs = new Set(existingPayments.map(payment => payment.utr?.toLowerCase().trim()).filter(Boolean));

          // Process CSV data and identify issues
          const paymentsToInsert = [];
          const duplicates = [];
          const invalidEntries = [];
          const newlyCreatedCustomers = [];

          for (const payment of payments) {
            const customerEmail = payment['Customer Email'].trim().toLowerCase();
            const utr = payment['UTR']?.trim() || '';
            const utrLower = utr.toLowerCase();
            const originalDate = payment['Date']?.trim() || '';
            const originalAmount = payment['Amount (INR)']?.toString() || '';

            // Check for duplicate UTR
            if (utr && existingUTRs.has(utrLower)) {
              // Mark this entry as having a duplicate UTR error
              payment.duplicateUtrError = `UTR "${utr}" already exists in the system`;
              duplicates.push(utr);
              // Don't continue - let it be processed and shown in bulk editor
            }

            // Find customer by email
            let customer = customers.find(c => c.email.toLowerCase() === customerEmail);
            
            // If customer doesn't exist, create them automatically
            if (!customer) {
              try {
                const { data: newCustomer, error: createError } = await supabase
                  .from('customers')
                  .insert([{ email: payment['Customer Email'].trim() }])
                  .select()
                  .single();

                if (createError) {
                  // If there's an error (like duplicate email), try to fetch the existing customer
                  const { data: existingCustomer, error: fetchError } = await supabase
                    .from('customers')
                    .select('*')
                    .eq('email', payment['Customer Email'].trim())
                    .single();

                  if (fetchError || !existingCustomer) {
                    invalidEntries.push(payment);
                    continue;
                  }
                  customer = existingCustomer;
                } else {
                  customer = newCustomer;
                  newlyCreatedCustomers.push(customer);
                }
              } catch (error) {
                console.error('Error creating customer:', error);
                invalidEntries.push(payment);
                continue;
              }
            }

            // Parse date - use auto-fix function to handle various formats
            let parsedDate;
            try {
              // Auto-fix the date format first
              const fixedDate = autoFixDateFormat(originalDate);
              
              // Convert DD/MM/YYYY to YYYY-MM-DD for database
              if (fixedDate.includes('/')) {
                const [day, month, year] = fixedDate.split('/');
                parsedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
              } else {
                parsedDate = new Date(fixedDate).toISOString().split('T')[0];
              }
            } catch (error) {
              invalidEntries.push(payment);
              continue;
            }

            // Parse amount
            const amount = parseFloat(originalAmount.replace(/[^\d.-]/g, ''));
            if (isNaN(amount) || amount <= 0) {
              invalidEntries.push(payment);
              continue;
            }

            paymentsToInsert.push({
              customer_id: customer.id,
              amount_inr: amount,
              date: parsedDate,
              utr: utr,
              notes: payment['Notes']?.trim() || ''
            });

            if (utr) {
              existingUTRs.add(utrLower);
            }
          }

          // Always show the bulk editor for preview and editing
          // Add newly created customers to the customers list for the bulk editor
          if (newlyCreatedCustomers.length > 0) {
            setCustomers(prevCustomers => [...newlyCreatedCustomers, ...prevCustomers]);
          }
          
          // Prepare all entries for the bulk editor
          const allEntries = [];
          
          // Add invalid entries first (they will be at the top due to sorting)
          invalidEntries.forEach(entry => {
            const customerEmail = entry['Customer Email'].trim().toLowerCase();
            const isNewCustomer = newlyCreatedCustomers.some(c => c.email.toLowerCase() === customerEmail);
            allEntries.push({
              ...entry,
              isNewCustomer,
              newlyCreatedCustomer: isNewCustomer ? newlyCreatedCustomers.find(c => c.email.toLowerCase() === customerEmail) : null
            });
          });
          
          // Add valid entries
          payments.forEach(payment => {
            const customerEmail = payment['Customer Email'].trim().toLowerCase();
            const isNewCustomer = newlyCreatedCustomers.some(c => c.email.toLowerCase() === customerEmail);
            
            // Auto-fix the date format for display in bulk editor
            const fixedDate = autoFixDateFormat(payment['Date']?.toString().trim() || '');
            
            allEntries.push({
              ...payment,
              'Date': fixedDate, // Use the fixed date format
              isNewCustomer,
              newlyCreatedCustomer: isNewCustomer ? newlyCreatedCustomers.find(c => c.email.toLowerCase() === customerEmail) : null
            });
          });
          
          setBulkEditorData(allEntries);
          setShowBulkEditor(true);
          setShowUploadForm(false);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          setUploadLoading(false);
        } catch (error) {
          console.error('Error importing payments:', error);
          setMessage('Error importing payments. Please try again.');
        } finally {
          setUploadLoading(false);
        }
      },
      error: (error) => {
        console.error('CSV parsing error:', error);
        setMessage('Error reading CSV file. Please check the file format.');
      }
    });
  };

  const handleSelectPayment = (paymentId) => {
    setSelectedPayments(prev => 
      prev.includes(paymentId) 
        ? prev.filter(id => id !== paymentId)
        : [...prev, paymentId]
    );
  };

  // Bulk editor handlers
  const handleBulkEditorSave = (count) => {
    setMessage(`Successfully imported ${count} payments from bulk editor`);
    setShowBulkEditor(false);
    setBulkEditorData([]);
    fetchData();
    
    // Refresh customers list to update payment totals
    if (window.refreshCustomersList) {
      window.refreshCustomersList();
    }
  };

  const handleBulkEditorCancel = () => {
    setShowBulkEditor(false);
    setBulkEditorData([]);
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedPayments([]);
      setSelectAll(false);
    } else {
      setSelectedPayments(payments.map(payment => payment.id));
      setSelectAll(true);
    }
  };

  // Function to group payments by customer and calculate totals
  const getGroupedPayments = () => {
    const grouped = {};
    
    payments.forEach(payment => {
      const customerEmail = payment.customers?.email || 'Unknown';
      
      if (!grouped[customerEmail]) {
        grouped[customerEmail] = {
          customerEmail,
          totalAmount: 0,
          paymentCount: 0,
          payments: [],
          customerId: payment.customer_id
        };
      }
      
      grouped[customerEmail].totalAmount += payment.amount_inr;
      grouped[customerEmail].paymentCount += 1;
      grouped[customerEmail].payments.push(payment);
    });
    
    // Sort by total amount (descending)
    return Object.values(grouped).sort((a, b) => b.totalAmount - a.totalAmount);
  };

  const moveToPayouts = async () => {
    if (selectedPayments.length === 0) {
      setMessage('Please select at least one payment to move');
      return;
    }

    if (!window.confirm(`Are you sure you want to move ${selectedPayments.length} payment(s) to payouts?`)) {
      return;
    }

    setLoading(true);
    try {
      // Get the selected payments data
      const paymentsToMove = payments.filter(payment => selectedPayments.includes(payment.id));
      
      // Insert into payouts table
      const payoutsToInsert = paymentsToMove.map(payment => ({
        customer_id: payment.customer_id,
        amount_inr: payment.amount_inr,
        date: payment.date,
        notes: payment.notes || ''
      }));

      const { error: insertError } = await supabase
        .from('payouts')
        .insert(payoutsToInsert);

      if (insertError) throw insertError;

      // Delete from payments table
      const { error: deleteError } = await supabase
        .from('payments')
        .delete()
        .in('id', selectedPayments);

      if (deleteError) throw deleteError;

      setMessage(`Successfully moved ${selectedPayments.length} payment(s) to payouts`);
      setSelectedPayments([]);
      setSelectAll(false);
      fetchData();
      
      // Refresh customers list to update totals
      if (window.refreshCustomersList) {
        window.refreshCustomersList();
      }
    } catch (error) {
      console.error('Error moving payments:', error);
      setMessage('Error moving payments to payouts');
    } finally {
      setLoading(false);
    }
  };

  // Function to check for duplicate UTRs across both payments and payouts
  const checkDuplicateUtrs = async () => {
    try {
      // Get all UTRs from payments table
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select('utr, id, customers(email), amount_inr, date')
        .not('utr', 'is', null);

      if (paymentsError) throw paymentsError;

      // Get all UTRs from payouts table (using notes field)
      const { data: payoutsData, error: payoutsError } = await supabase
        .from('payouts')
        .select('notes, id, customers(email), amount_inr, date')
        .not('notes', 'is', null);

      if (payoutsError) throw payoutsError;

      // Combine all UTRs
      const allUtrs = [
        ...paymentsData.map(p => ({ utr: p.utr, type: 'payment', id: p.id, customer: p.customers?.email, amount: p.amount_inr, date: p.date })),
        ...payoutsData.map(p => ({ utr: p.notes, type: 'payout', id: p.id, customer: p.customers?.email, amount: p.amount_inr, date: p.date }))
      ];

      // Find duplicates
      const utrCounts = {};
      const duplicateUtrs = [];

      allUtrs.forEach(item => {
        if (item.utr) {
          if (!utrCounts[item.utr]) {
            utrCounts[item.utr] = [];
          }
          utrCounts[item.utr].push(item);
        }
      });

      Object.keys(utrCounts).forEach(utr => {
        if (utrCounts[utr].length > 1) {
          duplicateUtrs.push({
            utr: utr,
            items: utrCounts[utr]
          });
        }
      });

      return duplicateUtrs;
    } catch (error) {
      console.error('Error checking duplicate UTRs:', error);
      return [];
    }
  };

  const bulkDeletePayments = async () => {
    if (selectedPayments.length === 0) {
      setMessage('Please select at least one payment to delete');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete ${selectedPayments.length} payment(s)? This action cannot be undone.`)) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('payments')
        .delete()
        .in('id', selectedPayments);

      if (error) throw error;

      // Check for duplicate UTRs after deletion
      const duplicateUtrs = await checkDuplicateUtrs();

      let message = `Successfully deleted ${selectedPayments.length} payment(s)`;
      
      if (duplicateUtrs.length > 0) {
        message += `. ⚠️ Found ${duplicateUtrs.length} duplicate UTR(s) remaining in the system: ${duplicateUtrs.map(d => d.utr).join(', ')}`;
      }

      setMessage(message);
      setSelectedPayments([]);
      setSelectAll(false);
      fetchData();
      
      // Refresh customers list to update payment totals
      if (window.refreshCustomersList) {
        window.refreshCustomersList();
      }
    } catch (error) {
      console.error('Error deleting payments:', error);
      setMessage('Error deleting payments');
    } finally {
      setLoading(false);
    }
  };

  const deleteDuplicateUtrs = async () => {
    if (duplicateUtrs.length === 0) return;
    
    if (!window.confirm(`Are you sure you want to delete ALL entries with duplicate UTRs? This will permanently delete ${duplicateUtrs.reduce((total, item) => total + item.items.length, 0)} entries. This action cannot be undone.`)) {
      return;
    }
    
    setDeletingUtrs(true);
    
    try {
      // Get all IDs to delete
      const paymentIds = [];
      const payoutIds = [];
      
      duplicateUtrs.forEach(item => {
        item.items.forEach(entry => {
          if (entry.type === 'payment') {
            paymentIds.push(entry.id);
          } else if (entry.type === 'payout') {
            payoutIds.push(entry.id);
          }
        });
      });
      
      // Delete payments with duplicate UTRs
      if (paymentIds.length > 0) {
        const { error: paymentsError } = await supabase
          .from('payments')
          .delete()
          .in('id', paymentIds);
        
        if (paymentsError) throw paymentsError;
      }
      
      // Delete payouts with duplicate UTRs
      if (payoutIds.length > 0) {
        const { error: payoutsError } = await supabase
          .from('payouts')
          .delete()
          .in('id', payoutIds);
        
        if (payoutsError) throw payoutsError;
      }
      
      const totalDeleted = paymentIds.length + payoutIds.length;
      setMessage(`Successfully deleted ${totalDeleted} entries with duplicate UTRs`);
      setDuplicateUtrs([]);
      setShowDuplicateUtrs(false);
      
      // Refresh data
      fetchData();
      
      // Refresh customers list to update totals
      if (window.refreshCustomersList) {
        window.refreshCustomersList();
      }
      
    } catch (error) {
      console.error('Error deleting duplicate UTRs:', error);
      setMessage('Error deleting duplicate UTRs');
    } finally {
      setDeletingUtrs(false);
    }
  };

  if (loading && payments.length === 0) {
    return (
      <div className="card">
        <h2>Loading payments...</h2>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Payments (Inflows)</h2>
        <div>
          <button onClick={() => setShowForm(true)} className="btn btn-primary">
            Add Payment
          </button>
          <button onClick={() => setShowUploadForm(true)} className="btn btn-success" style={{ marginLeft: '0.5rem' }}>
            Upload CSV
          </button>
          <button onClick={exportToCSV} className="btn btn-secondary" style={{ marginLeft: '0.5rem' }}>
            Export CSV
          </button>
          <button 
            onClick={async () => {
              setLoading(true);
              const duplicates = await checkDuplicateUtrs();
              if (duplicates.length > 0) {
                setDuplicateUtrs(duplicates);
                setShowDuplicateUtrs(true);
                setMessage(`⚠️ Found ${duplicates.length} duplicate UTR(s). Review and delete if needed.`);
              } else {
                setMessage('✅ No duplicate UTRs found in the system');
                setShowDuplicateUtrs(false);
                setDuplicateUtrs([]);
              }
              setLoading(false);
            }} 
            className="btn btn-warning" 
            style={{ marginLeft: '0.5rem' }}
            disabled={loading}
          >
            {loading ? 'Checking...' : 'Check Duplicate UTRs'}
          </button>
        </div>
      </div>

      {/* View Mode Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            onClick={() => setViewMode('list')} 
            className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
          >
            📋 List View
          </button>
          <button 
            onClick={() => setViewMode('grouped')} 
            className={`btn ${viewMode === 'grouped' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
          >
            📊 Grouped by Customer
          </button>
        </div>
        <div style={{ fontSize: '0.9rem', color: '#666' }}>
          {viewMode === 'list' ? `${payments.length} payment(s) loaded` : `${getGroupedPayments().length} customer(s)`}
          {hasMoreData && <span style={{ color: '#007bff', marginLeft: '0.5rem' }}>• More available</span>}
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedPayments.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', backgroundColor: '#f8f9fa', border: '2px solid #007bff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{selectedPayments.length} payment(s) selected</strong>
            </div>
            <div>
              <button 
                onClick={bulkDeletePayments} 
                className="btn btn-danger" 
                disabled={loading}
                style={{ marginRight: '0.5rem' }}
              >
                {loading ? 'Deleting...' : `Delete Selected (${selectedPayments.length})`}
              </button>
              <button 
                onClick={moveToPayouts} 
                className="btn btn-warning" 
                disabled={loading}
                style={{ marginRight: '0.5rem' }}
              >
                {loading ? 'Moving...' : `Move to Payouts (${selectedPayments.length})`}
              </button>
              <button 
                onClick={() => {
                  setSelectedPayments([]);
                  setSelectAll(false);
                }} 
                className="btn btn-secondary"
              >
                Clear Selection
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Duplicate UTRs Section */}
      {showDuplicateUtrs && duplicateUtrs.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', border: '2px solid #f59e0b', backgroundColor: '#fef3c7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#92400e' }}>
                ⚠️ Duplicate UTRs Found ({duplicateUtrs.length})
              </h3>
              <div style={{ fontSize: '0.9rem', color: '#92400e', marginTop: '0.25rem' }}>
                The following UTRs have multiple entries. You can delete all entries with duplicate UTRs to clean up the system.
              </div>
            </div>
            <div>
              <button 
                onClick={deleteDuplicateUtrs}
                className="btn btn-danger"
                disabled={deletingUtrs}
                style={{ marginRight: '0.5rem' }}
              >
                {deletingUtrs ? 'Deleting...' : `Delete All Duplicate UTRs (${duplicateUtrs.reduce((total, item) => total + item.items.length, 0)} entries)`}
              </button>
              <button 
                onClick={() => {
                  setShowDuplicateUtrs(false);
                  setDuplicateUtrs([]);
                }} 
                className="btn btn-secondary"
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.9rem' }}
              >
                × Close
              </button>
            </div>
          </div>
          
          <div style={{ overflowX: 'auto' }}>
            <table style={{ 
              width: '100%', 
              borderCollapse: 'collapse', 
              border: '1px solid #ddd',
              fontSize: '0.9rem'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#fef3c7' }}>
                  <th style={{ padding: '0.75rem', border: '1px solid #ddd', textAlign: 'left' }}>UTR</th>
                  <th style={{ padding: '0.75rem', border: '1px solid #ddd', textAlign: 'left' }}>Type</th>
                  <th style={{ padding: '0.75rem', border: '1px solid #ddd', textAlign: 'left' }}>Customer</th>
                  <th style={{ padding: '0.75rem', border: '1px solid #ddd', textAlign: 'left' }}>Amount</th>
                  <th style={{ padding: '0.75rem', border: '1px solid #ddd', textAlign: 'left' }}>Date</th>
                  <th style={{ padding: '0.75rem', border: '1px solid #ddd', textAlign: 'left' }}>ID</th>
                </tr>
              </thead>
              <tbody>
                {duplicateUtrs.map((item, index) => (
                  <React.Fragment key={index}>
                    {item.items.map((entry, entryIndex) => (
                      <tr key={`${index}-${entryIndex}`} style={{ backgroundColor: entryIndex % 2 === 0 ? '#fff' : '#f8f9fa' }}>
                        <td style={{ padding: '0.75rem', border: '1px solid #ddd', fontWeight: 'bold' }}>{entry.utr}</td>
                        <td style={{ padding: '0.75rem', border: '1px solid #ddd' }}>
                          <span style={{
                            backgroundColor: entry.type === 'payment' ? '#10B981' : '#F59E0B',
                            color: 'white',
                            padding: '0.25rem 0.5rem',
                            borderRadius: '4px',
                            fontSize: '0.8rem',
                            fontWeight: 'bold'
                          }}>
                            {entry.type === 'payment' ? 'Payment' : 'Payout'}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem', border: '1px solid #ddd' }}>{entry.customer || '-'}</td>
                        <td style={{ padding: '0.75rem', border: '1px solid #ddd' }}>₹{entry.amount?.toLocaleString() || '-'}</td>
                        <td style={{ padding: '0.75rem', border: '1px solid #ddd' }}>{entry.date ? format(new Date(entry.date), 'dd/MM/yyyy') : '-'}</td>
                        <td style={{ padding: '0.75rem', border: '1px solid #ddd', fontSize: '0.8rem', color: '#666' }}>{entry.id}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          
          <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#fff3cd', border: '1px solid #ffeaa7', borderRadius: '4px' }}>
            <strong>⚠️ Warning:</strong> Clicking "Delete All Duplicate UTRs" will permanently delete ALL entries with duplicate UTRs. 
            This action cannot be undone. Make sure you want to delete all {duplicateUtrs.reduce((total, item) => total + item.items.length, 0)} entries before proceeding.
          </div>
        </div>
      )}

       {/* Missing Entries Table */}
       {showMissingEntriesTable && (
         <div className="card" style={{ marginBottom: '1rem', border: '2px solid #ffc107' }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
             <div>
               <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#856404' }}>⚠️ Fix Missing/Invalid Entries</h3>
               <div style={{ fontSize: '0.8rem', color: '#856404', marginTop: '0.25rem' }}>
                 Please fix the errors below and save the corrected entries
               </div>
             </div>
             <button 
               onClick={() => {
                 setShowMissingEntriesTable(false);
                 setMissingEntriesData([]);
               }} 
               className="btn btn-secondary"
               style={{ padding: '0.25rem 0.5rem', fontSize: '0.9rem' }}
             >
               × Close
             </button>
           </div>
           
           <form onSubmit={handleMissingEntriesSubmit}>
             <div style={{ marginBottom: '1rem', position: 'relative' }}>
               <div style={{ overflowX: 'auto' }}>
                 <table style={{ 
                   width: '100%', 
                   borderCollapse: 'collapse', 
                   border: '1px solid #ddd',
                   fontSize: '0.9rem'
                 }}>
                   <thead>
                     <tr style={{ backgroundColor: '#fff3cd' }}>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'left',
                         minWidth: '200px'
                       }}>
                         Customer Email *
                       </th>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'left',
                         minWidth: '150px'
                       }}>
                         Amount (INR) *
                       </th>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'left',
                         minWidth: '120px'
                       }}>
                         Date (DD/MM/YYYY) *
                       </th>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'left',
                         minWidth: '150px'
                       }}>
                         UTR Number
                       </th>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'left',
                         minWidth: '150px'
                       }}>
                         Notes
                       </th>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'center',
                         minWidth: '100px'
                       }}>
                         Error
                       </th>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'center',
                         width: '60px'
                       }}>
                         Action
                       </th>
                     </tr>
                   </thead>
                   <tbody>
                     {missingEntriesData.map((row, index) => (
                       <tr key={index} style={{ 
                         backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9f9f9',
                         borderBottom: '1px solid #eee'
                       }}>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                           <input
                             type="text"
                             value={row.customer_email}
                             onChange={(e) => updateMissingEntry(index, 'customer_email', e.target.value)}
                             placeholder="customer@example.com"
                             style={{
                               width: '100%',
                               padding: '0.5rem',
                               border: '1px solid #ccc',
                               borderRadius: '4px',
                               fontSize: '0.9rem'
                             }}
                             required
                           />
                         </td>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                           <input
                             type="number"
                             value={row.amount_inr}
                             onChange={(e) => updateMissingEntry(index, 'amount_inr', e.target.value)}
                             step="0.01"
                             min="0"
                             placeholder="0.00"
                             style={{
                               width: '100%',
                               padding: '0.5rem',
                               border: '1px solid #ccc',
                               borderRadius: '4px',
                               fontSize: '0.9rem'
                             }}
                             required
                           />
                         </td>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                           <input
                             type="text"
                             value={row.date}
                             onChange={(e) => updateMissingEntry(index, 'date', e.target.value)}
                             placeholder="DD/MM/YYYY or DD-MMM-YY"
                             style={{
                               width: '100%',
                               padding: '0.5rem',
                               border: row.date && !validateDate(row.date) ? '1px solid #dc3545' : '1px solid #ccc',
                               borderRadius: '4px',
                               fontSize: '0.9rem',
                               backgroundColor: row.date && !validateDate(row.date) ? '#fff5f5' : 'white'
                             }}
                             required
                           />
                           {row.date && !validateDate(row.date) && (
                             <div style={{ 
                               fontSize: '0.75rem', 
                               color: '#dc3545', 
                               marginTop: '0.25rem' 
                             }}>
                               Please enter a valid date in DD/MM/YYYY or DD-MMM-YY format
                             </div>
                           )}
                         </td>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                           <input
                             type="text"
                             value={row.utr}
                             onChange={(e) => updateMissingEntry(index, 'utr', e.target.value)}
                             placeholder="UTR123456789"
                             style={{
                               width: '100%',
                               padding: '0.5rem',
                               border: '1px solid #ccc',
                               borderRadius: '4px',
                               fontSize: '0.9rem'
                             }}
                           />
                         </td>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                           <input
                             type="text"
                             value={row.notes}
                             onChange={(e) => updateMissingEntry(index, 'notes', e.target.value)}
                             placeholder="Notes"
                             style={{
                               width: '100%',
                               padding: '0.5rem',
                               border: '1px solid #ccc',
                               borderRadius: '4px',
                               fontSize: '0.9rem'
                             }}
                           />
                         </td>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd', textAlign: 'center' }}>
                           <span style={{ 
                             fontSize: '0.75rem', 
                             color: '#dc3545',
                             fontWeight: 'bold'
                           }}>
                             {row.error}
                           </span>
                         </td>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd', textAlign: 'center' }}>
                           <button
                             type="button"
                             onClick={() => removeMissingEntry(index)}
                             style={{
                               background: '#dc3545',
                               color: 'white',
                               border: 'none',
                               borderRadius: '50%',
                               width: '24px',
                               height: '24px',
                               fontSize: '14px',
                               cursor: 'pointer',
                               display: 'flex',
                               alignItems: 'center',
                               justifyContent: 'center'
                             }}
                             title="Remove this row"
                           >
                             ×
                           </button>
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
             </div>
             
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
               <div style={{ fontSize: '0.9rem', color: '#856404' }}>
                 {missingEntriesData.filter(row => row.customer_email && row.amount_inr && row.amount_inr > 0 && validateDate(row.date)).length} valid row(s) ready to save
               </div>
             </div>
             
             <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
               <button 
                 type="submit" 
                 className="btn btn-warning" 
                 disabled={missingEntriesLoading}
                 style={{ padding: '0.75rem 1.5rem', fontSize: '1rem' }}
               >
                 {missingEntriesLoading ? 'Saving...' : `Save ${missingEntriesData.filter(row => row.customer_email && row.amount_inr && row.amount_inr > 0 && validateDate(row.date)).length} Corrected Payment(s)`}
               </button>
               <button 
                 type="button" 
                 onClick={() => {
                   setShowMissingEntriesTable(false);
                   setMissingEntriesData([]);
                 }} 
                 className="btn btn-secondary"
                 style={{ padding: '0.75rem 1.5rem', fontSize: '1rem' }}
               >
                 Cancel
               </button>
             </div>
           </form>
         </div>
       )}

       {showForm && (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem' }}>{editingPayment ? 'Edit Payment' : 'Add New Payment'}</h3>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
            <div className="form-group" style={{ marginBottom: '0' }}>
              <label htmlFor="customer_search" style={{ fontSize: '0.9rem', marginBottom: '0.25rem' }}>Customer *</label>
              <div style={{ position: 'relative' }} className="customer-dropdown-container">
                                 <input
                   type="text"
                   id="customer_search"
                   placeholder="Search for customer..."
                   value={customerSearch}
                   onChange={handleCustomerEmailChange}
                   onFocus={() => setShowCustomerDropdown(true)}
                   style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                   required={!formData.customer_id}
                 />
                {showCustomerDropdown && customerSearch && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    backgroundColor: 'white',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    zIndex: 1000,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                  }}>
                    {filteredCustomers.length > 0 ? (
                      filteredCustomers.map((customer) => (
                        <div
                          key={customer.id}
                          onClick={() => handleCustomerSelect(customer)}
                          style={{
                            padding: '0.5rem',
                            cursor: 'pointer',
                            borderBottom: '1px solid #eee',
                            fontSize: '0.9rem'
                          }}
                          onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                          onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                        >
                          {customer.email}
                        </div>
                      ))
                    ) : (
                      <div style={{ padding: '0.5rem', color: '#666', fontSize: '0.9rem' }}>
                        No customers found
                      </div>
                    )}
                  </div>
                )}
              </div>
              {formData.customer_id && (
                <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                  Selected: {getSelectedCustomerEmail()}
                </div>
              )}
            </div>
            
                                      <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>Payment Details</label>
                </div>
               
               {formData.payments.map((payment, index) => (
                 <div key={index} style={{ 
                   border: '1px solid #ddd', 
                   borderRadius: '8px', 
                   padding: '1rem', 
                   marginBottom: '0.75rem',
                   backgroundColor: '#f9f9f9'
                 }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                     <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#666' }}>
                       Payment {index + 1}
                     </span>
                     {!editingPayment && formData.payments.length > 1 && (
                       <button
                         type="button"
                         onClick={() => removePaymentRow(index)}
                         style={{
                           background: '#dc3545',
                           color: 'white',
                           border: 'none',
                           borderRadius: '50%',
                           width: '24px',
                           height: '24px',
                           fontSize: '14px',
                           cursor: 'pointer',
                           display: 'flex',
                           alignItems: 'center',
                           justifyContent: 'center'
                         }}
                         title="Remove this payment"
                       >
                         ×
                       </button>
                     )}
                   </div>
                   
                   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                     <div className="form-group" style={{ marginBottom: '0' }}>
                       <label style={{ fontSize: '0.8rem', marginBottom: '0.25rem', display: 'block' }}>Amount (INR) *</label>
                       <input
                         type="number"
                         value={payment.amount_inr}
                         onChange={(e) => updatePaymentRow(index, 'amount_inr', e.target.value)}
                         step="0.01"
                         min="0"
                         required
                         style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                         placeholder="0.00"
                       />
                     </div>
                     <div className="form-group" style={{ marginBottom: '0' }}>
                       <label style={{ fontSize: '0.8rem', marginBottom: '0.25rem', display: 'block' }}>Date *</label>
                       <input
                         type="text"
                         value={payment.date}
                         onChange={(e) => updatePaymentRow(index, 'date', e.target.value)}
                         placeholder="DD/MM/YYYY or DD-MMM-YY (e.g., 01/01/2023 or 30-Aug-22)"
                         style={{ 
                           width: '100%', 
                           padding: '0.5rem', 
                           border: payment.date && !validateDate(payment.date) ? '1px solid #dc3545' : '1px solid #ddd', 
                           borderRadius: '4px', 
                           fontSize: '0.9rem',
                           backgroundColor: payment.date && !validateDate(payment.date) ? '#fff5f5' : 'white'
                         }}
                         required
                       />
                       {payment.date && !validateDate(payment.date) && (
                         <div style={{ 
                           fontSize: '0.75rem', 
                           color: '#dc3545', 
                           marginTop: '0.25rem' 
                         }}>
                           Please enter a valid date in DD/MM/YYYY or DD-MMM-YY format (2022-2023)
                         </div>
                       )}
                     </div>
                                           <div className="form-group" style={{ marginBottom: '0' }}>
                        <label style={{ fontSize: '0.8rem', marginBottom: '0.25rem', display: 'block' }}>UTR Number</label>
                        <input
                          type="text"
                          value={payment.utr}
                          onChange={(e) => updatePaymentRow(index, 'utr', e.target.value)}
                          style={{ 
                            width: '100%', 
                            padding: '0.5rem', 
                            border: payment.utr && utrValidation[index] ? 
                              (utrValidation[index].isValid ? '1px solid #28a745' : '1px solid #dc3545') : 
                              '1px solid #ddd', 
                            borderRadius: '4px', 
                            fontSize: '0.9rem',
                            backgroundColor: payment.utr && utrValidation[index] && !utrValidation[index].isValid ? '#fff5f5' : 'white'
                          }}
                          placeholder="UTR123456789"
                        />
                        {payment.utr && utrValidation[index] && (
                          <div style={{ 
                            fontSize: '0.75rem', 
                            color: utrValidation[index].isValid ? '#28a745' : '#dc3545', 
                            marginTop: '0.25rem' 
                          }}>
                            {utrValidation[index].message}
                          </div>
                        )}
                      </div>
                   </div>
                   
                   <div className="form-group" style={{ marginBottom: '0' }}>
                     <label style={{ fontSize: '0.8rem', marginBottom: '0.25rem', display: 'block' }}>Notes</label>
                     <textarea
                       value={payment.notes}
                       onChange={(e) => updatePaymentRow(index, 'notes', e.target.value)}
                       style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', minHeight: '40px', resize: 'vertical', fontSize: '0.9rem' }}
                       placeholder="Optional notes for this payment..."
                     />
                   </div>
                 </div>
                               ))}
              </div>
             
             {/* Add Payment Row Button */}
             {!editingPayment && (
               <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                 <button
                   type="button"
                   onClick={addPaymentRow}
                   style={{
                     background: '#28a745',
                     color: 'white',
                     border: 'none',
                     borderRadius: '50%',
                     width: '40px',
                     height: '40px',
                     fontSize: '20px',
                     cursor: 'pointer',
                     display: 'flex',
                     alignItems: 'center',
                     justifyContent: 'center',
                     boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                   }}
                   title="Add another payment"
                 >
                   +
                 </button>
               </div>
             )}
             
             <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
               <button type="submit" className="btn btn-success" disabled={loading} style={{ flex: 1, padding: '0.5rem' }}>
                 {loading ? 'Saving...' : (editingPayment ? 'Update' : 'Save')}
               </button>
               <button type="button" onClick={handleCancel} className="btn btn-secondary" style={{ padding: '0.5rem' }}>
                 Cancel
               </button>
             </div>
          </form>
        </div>
      )}

      {showUploadForm && (
        <div className="card">
          <h3>Upload Payments from CSV</h3>
          <div style={{ marginBottom: '1rem' }}>
            <p><strong>CSV Format Requirements:</strong></p>
            <ul style={{ marginLeft: '1rem', marginBottom: '1rem' }}>
              <li>First row should contain headers: "Customer Email", "Amount (INR)", "Date", "UTR" (optional), "Notes" (optional)</li>
              <li>Customer Email must exist in the system</li>
              <li>Date format: DD/MM/YYYY (e.g., 01/01/2024)</li>
              <li>Amount should be a positive number</li>
              <li>UTR is optional but must be unique if provided</li>
              <li>Duplicate UTRs will be automatically skipped</li>
            </ul>
            <button onClick={downloadSampleCSV} className="btn btn-secondary btn-sm">
              Download Sample CSV
            </button>
          </div>
          <form>
            <div className="form-group">
              <label htmlFor="csvFile">Select CSV File</label>
              <input
                type="file"
                id="csvFile"
                accept=".csv"
                ref={fileInputRef}
                onChange={handleFileUpload}
                disabled={uploadLoading}
              />
            </div>
            <div>
              <button 
                type="button" 
                onClick={() => setShowUploadForm(false)} 
                className="btn btn-secondary"
                disabled={uploadLoading}
              >
                Cancel
              </button>
            </div>
          </form>
          {uploadLoading && (
            <div style={{ marginTop: '1rem' }}>
              <p>Uploading payments...</p>
            </div>
          )}
        </div>
      )}

      <div className="card">
        {viewMode === 'list' ? (
          // List View
          <table className="table" style={{ fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={{ padding: '0.5rem', width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={handleSelectAll}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th style={{ padding: '0.5rem' }}>Customer</th>
                <th style={{ padding: '0.5rem' }}>Amount</th>
                <th style={{ padding: '0.5rem' }}>Date</th>
                <th style={{ padding: '0.5rem' }}>UTR</th>
                <th style={{ padding: '0.5rem' }}>Notes</th>
                <th style={{ padding: '0.5rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} style={{ 
                  backgroundColor: selectedPayments.includes(payment.id) ? '#e3f2fd' : 'inherit' 
                }}>
                  <td style={{ padding: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedPayments.includes(payment.id)}
                      onChange={() => handleSelectPayment(payment.id)}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ padding: '0.5rem' }}>{payment.customers?.email || 'Unknown'}</td>
                  <td style={{ padding: '0.5rem' }} className="positive">₹{payment.amount_inr.toLocaleString()}</td>
                  <td style={{ padding: '0.5rem' }}>{format(new Date(payment.date), 'MMM dd, yyyy')}</td>
                  <td style={{ padding: '0.5rem' }}>{payment.utr || '-'}</td>
                  <td style={{ padding: '0.5rem' }}>{payment.notes || '-'}</td>
                  <td style={{ padding: '0.5rem' }} className="actions">
                    <button onClick={() => handleEdit(payment)} className="btn btn-primary btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>
                      Edit
                    </button>
                    <button onClick={() => handleDelete(payment.id)} className="btn btn-danger btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginLeft: '0.25rem' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          // Grouped View
          <div>
            {/* Summary Card */}
            <div style={{ 
              backgroundColor: '#f8f9fa', 
              border: '1px solid #ddd', 
              borderRadius: '8px', 
              padding: '1rem', 
              marginBottom: '1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>
                  📊 Payments Summary
                </h4>
                <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.25rem' }}>
                  {getGroupedPayments().length} customer(s) • {payments.length} total payment(s)
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#28a745' }}>
                  ₹{payments.reduce((total, payment) => total + payment.amount_inr, 0).toLocaleString()}
                </div>
                <div style={{ fontSize: '0.9rem', color: '#666' }}>
                  Total Payments Amount
                </div>
              </div>
            </div>
            
            {getGroupedPayments().map((group, groupIndex) => (
              <div key={group.customerEmail} style={{ 
                border: '1px solid #ddd', 
                borderRadius: '8px', 
                marginBottom: '1rem',
                overflow: 'hidden'
              }}>
                {/* Customer Header */}
                <div style={{ 
                  backgroundColor: '#f8f9fa', 
                  padding: '1rem', 
                  borderBottom: '1px solid #ddd',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold' }}>
                      {group.customerEmail}
                    </h4>
                    <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.25rem' }}>
                      {group.paymentCount} payment(s) • Total: <span style={{ fontWeight: 'bold', color: '#28a745' }}>₹{group.totalAmount.toLocaleString()}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#28a745' }}>
                      ₹{group.totalAmount.toLocaleString()}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>
                      Total Payments
                    </div>
                  </div>
                </div>
                
                {/* Payments Table */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ 
                    width: '100%', 
                    borderCollapse: 'collapse',
                    fontSize: '0.9rem'
                  }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8f9fa' }}>
                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #ddd', textAlign: 'left' }}>Amount</th>
                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #ddd', textAlign: 'left' }}>Date</th>
                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #ddd', textAlign: 'left' }}>UTR</th>
                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #ddd', textAlign: 'left' }}>Notes</th>
                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #ddd', textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td style={{ padding: '0.75rem', borderBottom: '1px solid #eee', fontWeight: 'bold', color: '#28a745' }}>
                            ₹{payment.amount_inr.toLocaleString()}
                          </td>
                          <td style={{ padding: '0.75rem', borderBottom: '1px solid #eee' }}>
                            {format(new Date(payment.date), 'MMM dd, yyyy')}
                          </td>
                          <td style={{ padding: '0.75rem', borderBottom: '1px solid #eee' }}>
                            {payment.utr || '-'}
                          </td>
                          <td style={{ padding: '0.75rem', borderBottom: '1px solid #eee' }}>
                            {payment.notes || '-'}
                          </td>
                          <td style={{ padding: '0.75rem', borderBottom: '1px solid #eee', textAlign: 'center' }}>
                            <button onClick={() => handleEdit(payment)} className="btn btn-primary btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>
                              Edit
                            </button>
                            <button onClick={() => handleDelete(payment.id)} className="btn btn-danger btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginLeft: '0.25rem' }}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {payments.length === 0 && <p style={{ textAlign: 'center', color: '#666', padding: '1rem' }}>No payments found</p>}
        
        {/* Load More Button */}
        {hasMoreData && (
          <div style={{ textAlign: 'center', marginTop: '1rem', padding: '1rem' }}>
            <button 
              onClick={() => fetchData(true)} 
              className="btn btn-primary"
              disabled={isLoadingMore}
              style={{ 
                padding: '0.75rem 2rem', 
                fontSize: '1rem',
                backgroundColor: isLoadingMore ? '#6c757d' : '#007bff',
                border: 'none',
                borderRadius: '4px',
                color: 'white',
                cursor: isLoadingMore ? 'not-allowed' : 'pointer'
              }}
            >
              {isLoadingMore ? 'Loading More...' : `Load More (${totalLoaded} loaded)`}
            </button>
            <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.5rem' }}>
              {isLoadingMore ? 'Please wait while we load the next 1000 records...' : 'Click to load the next 1000 payment records'}
            </div>
          </div>
        )}
      </div>

      {/* Bulk Upload Editor */}
      {showBulkEditor && (
        <BulkUploadEditor
          type="payments"
          csvData={bulkEditorData}
          onSave={handleBulkEditorSave}
          onCancel={handleBulkEditorCancel}
          customers={customers}
        />
      )}
    </div>
  );
}

export default Payments;
