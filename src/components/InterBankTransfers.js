import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { format } from 'date-fns';
import Papa from 'papaparse';
import InterBankTransfersBulkEditor from './InterBankTransfersBulkEditor';

function InterBankTransfers() {
  const [transfers, setTransfers] = useState([]);
  const [bankTags, setBankTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTransfer, setEditingTransfer] = useState(null);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [sortConfig, setSortConfig] = useState({
    key: 'date',
    direction: 'desc'
  });
  const [formData, setFormData] = useState({
    from_bank: '',
    to_bank: '',
    amount_inr: '',
    date: '01/01/2023',
    utr: '',
    notes: ''
  });
  const [message, setMessage] = useState('');
  const [showTagForm, setShowTagForm] = useState(false);
  const [editingTag, setEditingTag] = useState(null);
  const [tagFormData, setTagFormData] = useState({
    name: '',
    color: '#3B82F6'
  });

  // Match functionality state
  const [showMatchForm, setShowMatchForm] = useState(false);
  const [matchingTransfer, setMatchingTransfer] = useState(null);
  const [matchFormData, setMatchFormData] = useState({
    from_bank: '',
    to_bank: '',
    amount_inr: '',
    date: '01/01/2023',
    utr: '',
    notes: ''
  });

  // CSV Bulk upload state
  const [showCsvUpload, setShowCsvUpload] = useState(false);
  const [csvData, setCsvData] = useState([]);
  const [csvFile, setCsvFile] = useState(null);
  const [showBulkEditor, setShowBulkEditor] = useState(false);

  // Bank dropdowns data
  const [fromBanks, setFromBanks] = useState([]);
  const [toBanks, setToBanks] = useState([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Fetch inter bank transfers with bank tag information
      const { data: transfersData, error: transfersError } = await supabase
        .from('inter_bank_transfers')
        .select(`
          *,
          tags (name, color)
        `)
        .order('date', { ascending: false });

      if (transfersError) throw transfersError;

      // Fetch all tags (not just bank-related ones)
      const { data: tagsData, error: tagsError } = await supabase
        .from('tags')
        .select('id, name, color')
        .order('name');

      if (tagsError) throw tagsError;

      // Process transfers to add matching information
      const processedTransfers = processTransfersWithMatching(transfersData || []);
      setTransfers(processedTransfers);
      setBankTags(tagsData || []);

      // Extract unique bank names from existing transfers for dropdowns
      const fromBankSet = new Set();
      const toBankSet = new Set();
      
      transfersData?.forEach(transfer => {
        if (transfer.from_bank) fromBankSet.add(transfer.from_bank);
        if (transfer.to_bank) toBankSet.add(transfer.to_bank);
      });

      setFromBanks(Array.from(fromBankSet).sort());
      setToBanks(Array.from(toBankSet).sort());
    } catch (error) {
      console.error('Error fetching data:', error);
      setMessage('Error fetching data');
    } finally {
      setLoading(false);
    }
  };

  const processTransfersWithMatching = (transfers) => {
    // First, try to match by UTR (most reliable)
    const utrGroups = {};
    const unmatchedTransfers = [];
    
    transfers.forEach(transfer => {
      if (transfer.utr && transfer.utr.trim() !== '') {
        const utr = transfer.utr.trim().replace(/,/g, ''); // Remove commas
        if (!utrGroups[utr]) {
          utrGroups[utr] = [];
        }
        utrGroups[utr].push(transfer);
      } else {
        unmatchedTransfers.push(transfer);
      }
    });

    const processedTransfers = [];
    
    // Process UTR-matched transfers
    Object.values(utrGroups).forEach(group => {
      if (group.length === 1) {
        // Single transfer with UTR - no match
        const transfer = group[0];
        processedTransfers.push({
          ...transfer,
          matchStatus: 'no-match',
          matchAmount: 0,
          matchingTransfer: null,
          groupId: `utr_${transfer.utr}`,
          displayOrder: 1,
          transferType: 'transfer'
        });
      } else if (group.length === 2) {
        // Two transfers with same UTR - check if they match
        const [transfer1, transfer2] = group;
        
        // Check if they are reverse transfers (same UTR, reverse banks, same amount)
        const isReverseTransfer = transfer1.from_bank === transfer2.to_bank && 
                                 transfer1.to_bank === transfer2.from_bank &&
                                 transfer1.amount_inr === transfer2.amount_inr;
        
        if (isReverseTransfer) {
          // Perfect match - sent and received
          processedTransfers.push({
            ...transfer1,
            matchStatus: 'perfect-match',
            matchAmount: 0,
            matchingTransfer: transfer2,
            transferType: 'sent',
            groupId: `utr_${transfer1.utr}`,
            displayOrder: 1
          });
          
          processedTransfers.push({
            ...transfer2,
            matchStatus: 'perfect-match',
            matchAmount: 0,
            matchingTransfer: transfer1,
            transferType: 'received',
            groupId: `utr_${transfer2.utr}`,
            displayOrder: 2
          });
        } else {
          // Same UTR but different banks or amounts - mismatch
          const amountDiff = Math.abs(transfer1.amount_inr - transfer2.amount_inr);
          processedTransfers.push({
            ...transfer1,
            matchStatus: 'mismatch',
            matchAmount: transfer1.amount_inr - transfer2.amount_inr,
            matchingTransfer: transfer2,
            transferType: 'sent',
            groupId: `utr_${transfer1.utr}`,
            displayOrder: 1
          });
          
          processedTransfers.push({
            ...transfer2,
            matchStatus: 'mismatch',
            matchAmount: transfer2.amount_inr - transfer1.amount_inr,
            matchingTransfer: transfer1,
            transferType: 'received',
            groupId: `utr_${transfer2.utr}`,
            displayOrder: 2
          });
        }
      } else {
        // More than 2 transfers with same UTR - complex
        group.forEach((transfer, index) => {
          processedTransfers.push({
            ...transfer,
            matchStatus: 'complex',
            matchAmount: 0,
            matchingTransfer: null,
            groupId: `utr_${transfer.utr}_complex`,
            displayOrder: index + 1,
            transferType: 'transfer'
          });
        });
      }
    });

    // Now process unmatched transfers by date and bank pairs
    const dateBankGroups = {};
    
    unmatchedTransfers.forEach(transfer => {
      const key = `${transfer.date}_${transfer.from_bank}_${transfer.to_bank}`;
      const reverseKey = `${transfer.date}_${transfer.to_bank}_${transfer.from_bank}`;
      
      if (!dateBankGroups[key] && !dateBankGroups[reverseKey]) {
        dateBankGroups[key] = [];
      }
      
      const groupKey = dateBankGroups[key] ? key : reverseKey;
      dateBankGroups[groupKey].push(transfer);
    });

    Object.values(dateBankGroups).forEach(group => {
      if (group.length === 1) {
        // Single transfer - no match
        const transfer = group[0];
        processedTransfers.push({
          ...transfer,
          matchStatus: 'no-match',
          matchAmount: 0,
          matchingTransfer: null,
          groupId: `${transfer.date}_${transfer.from_bank}_${transfer.to_bank}`,
          displayOrder: 1,
          transferType: 'transfer'
        });
      } else if (group.length === 2) {
        // Two transfers - check if they match
        const [transfer1, transfer2] = group;
        
        // Check if they are reverse transfers with same amount
        const isReverseTransfer = transfer1.from_bank === transfer2.to_bank && 
                                 transfer1.to_bank === transfer2.from_bank &&
                                 transfer1.amount_inr === transfer2.amount_inr;
        
        if (isReverseTransfer) {
          // Perfect match
          processedTransfers.push({
            ...transfer1,
            matchStatus: 'perfect-match',
            matchAmount: 0,
            matchingTransfer: transfer2,
            transferType: 'sent',
            groupId: `${transfer1.date}_${transfer1.from_bank}_${transfer1.to_bank}`,
            displayOrder: 1
          });
          
          processedTransfers.push({
            ...transfer2,
            matchStatus: 'perfect-match',
            matchAmount: 0,
            matchingTransfer: transfer1,
            transferType: 'received',
            groupId: `${transfer2.date}_${transfer2.from_bank}_${transfer2.to_bank}`,
            displayOrder: 2
          });
        } else {
          // Mismatch
          const amountDiff = Math.abs(transfer1.amount_inr - transfer2.amount_inr);
          processedTransfers.push({
            ...transfer1,
            matchStatus: 'mismatch',
            matchAmount: transfer1.amount_inr - transfer2.amount_inr,
            matchingTransfer: transfer2,
            transferType: 'sent',
            groupId: `${transfer1.date}_${transfer1.from_bank}_${transfer1.to_bank}`,
            displayOrder: 1
          });
          
          processedTransfers.push({
            ...transfer2,
            matchStatus: 'mismatch',
            matchAmount: transfer2.amount_inr - transfer1.amount_inr,
            matchingTransfer: transfer1,
            transferType: 'received',
            groupId: `${transfer2.date}_${transfer2.from_bank}_${transfer2.to_bank}`,
            displayOrder: 2
          });
        }
      } else {
        // More than 2 transfers - complex
        group.forEach((transfer, index) => {
          processedTransfers.push({
            ...transfer,
            matchStatus: 'complex',
            matchAmount: 0,
            matchingTransfer: null,
            groupId: `${transfer.date}_${transfer.from_bank}_${transfer.to_bank}_complex`,
            displayOrder: index + 1,
            transferType: 'transfer'
          });
        });
      }
    });

         // Sort by date (newest first), then by groupId, then by displayOrder
     return processedTransfers.sort((a, b) => {
       const dateComparison = new Date(b.date) - new Date(a.date);
       if (dateComparison !== 0) return dateComparison;
       
       const groupComparison = a.groupId.localeCompare(b.groupId);
       if (groupComparison !== 0) return groupComparison;
       
       return a.displayOrder - b.displayOrder;
     });
   };

   const sortData = (data) => {
     if (!sortConfig.key) return data;

     return [...data].sort((a, b) => {
       let aValue = a[sortConfig.key];
       let bValue = b[sortConfig.key];

       // Handle different data types
       if (sortConfig.key === 'date') {
         aValue = new Date(aValue);
         bValue = new Date(bValue);
       } else if (sortConfig.key === 'amount_inr') {
         aValue = parseFloat(aValue) || 0;
         bValue = parseFloat(bValue) || 0;
       } else if (sortConfig.key === 'utr') {
         aValue = (aValue || '').toString().toLowerCase();
         bValue = (bValue || '').toString().toLowerCase();
       } else {
         aValue = (aValue || '').toString().toLowerCase();
         bValue = (bValue || '').toString().toLowerCase();
       }

       if (aValue < bValue) {
         return sortConfig.direction === 'asc' ? -1 : 1;
       }
       if (aValue > bValue) {
         return sortConfig.direction === 'asc' ? 1 : -1;
       }
       return 0;
     });
   };

   const handleSort = (key) => {
     setSortConfig(prevConfig => ({
       key,
       direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
     }));
   };

   const getSortIcon = (key) => {
     if (sortConfig.key !== key) {
       return '↕️';
     }
     return sortConfig.direction === 'asc' ? '↑' : '↓';
   };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate required fields
      if (!formData.from_bank || !formData.to_bank || !formData.amount_inr) {
        setMessage('Please fill in all required fields');
        setLoading(false);
        return;
      }

      let dbDate = formData.date;
      
      // Handle DD/MM/YYYY format
      if (formData.date.includes('/')) {
        const [day, month, year] = formData.date.split('/');
        dbDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
      
      const transferData = {
        from_bank: formData.from_bank,
        to_bank: formData.to_bank,
        amount_inr: parseFloat(formData.amount_inr),
        date: dbDate,
        utr: formData.utr ? formData.utr.replace(/,/g, '') : null, // Clean UTR before saving
        notes: formData.notes
      };

      if (editingTransfer) {
        const { error } = await supabase
          .from('inter_bank_transfers')
          .update(transferData)
          .eq('id', editingTransfer.id);

        if (error) throw error;
        setMessage('Transfer updated successfully');
      } else {
        const { error } = await supabase
          .from('inter_bank_transfers')
          .insert([transferData]);

        if (error) throw error;
        setMessage('Transfer added successfully');
      }

      setFormData({
        from_bank: '',
        to_bank: '',
        amount_inr: '',
        date: '01/01/2023',
        utr: '',
        notes: ''
      });
             setShowForm(false);
       setEditingTransfer(null);
       setExpandedRows(new Set());
       fetchData();
    } catch (error) {
      console.error('Error saving transfer:', error);
      setMessage('Error saving transfer');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (transfer) => {
    setEditingTransfer(transfer);
    setFormData({
      from_bank: transfer.from_bank || '',
      to_bank: transfer.to_bank || '',
      amount_inr: transfer.amount_inr.toString(),
      date: format(new Date(transfer.date), 'dd/MM/yyyy'),
      utr: transfer.utr || '',
      notes: transfer.notes || ''
    });
    setExpandedRows(new Set([transfer.id]));
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this transfer?')) return;

    try {
      const { error } = await supabase
        .from('inter_bank_transfers')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setMessage('Transfer deleted successfully');
      fetchData();
    } catch (error) {
      console.error('Error deleting transfer:', error);
      setMessage('Error deleting transfer');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingTransfer(null);
    setExpandedRows(new Set());
    setFormData({
      from_bank: '',
      to_bank: '',
      amount_inr: '',
      date: '01/01/2023',
      utr: '',
      notes: ''
    });
  };

  // Match functionality handlers
  const handleMatch = (transfer) => {
    setMatchingTransfer(transfer);
    setMatchFormData({
      from_bank: transfer.to_bank || '', // Reverse the banks for matching
      to_bank: transfer.from_bank || '',
      amount_inr: transfer.amount_inr.toString(),
      date: format(new Date(transfer.date), 'dd/MM/yyyy'),
      utr: transfer.utr || '', // Use same UTR for matching
      notes: `Match for transfer ${transfer.id}`
    });
    setShowMatchForm(true);
    setExpandedRows(new Set([transfer.id]));
  };

  const handleMatchSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate required fields
      if (!matchFormData.from_bank || !matchFormData.to_bank || !matchFormData.amount_inr) {
        setMessage('Please fill in all required fields');
        setLoading(false);
        return;
      }

      let dbDate = matchFormData.date;
      
      // Handle DD/MM/YYYY format
      if (matchFormData.date.includes('/')) {
        const [day, month, year] = matchFormData.date.split('/');
        dbDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
      
      const transferData = {
        from_bank: matchFormData.from_bank,
        to_bank: matchFormData.to_bank,
        amount_inr: parseFloat(matchFormData.amount_inr),
        date: dbDate,
        utr: matchFormData.utr ? matchFormData.utr.replace(/,/g, '') : null,
        notes: matchFormData.notes
      };

      const { error } = await supabase
        .from('inter_bank_transfers')
        .insert([transferData]);

      if (error) throw error;
      setMessage('Match transfer added successfully');
      
      setMatchFormData({
        from_bank: '',
        to_bank: '',
        amount_inr: '',
        date: '01/01/2023',
        utr: '',
        notes: ''
      });
      setShowMatchForm(false);
      setMatchingTransfer(null);
      setExpandedRows(new Set());
      fetchData();
    } catch (error) {
      console.error('Error saving match transfer:', error);
      setMessage('Error saving match transfer');
    } finally {
      setLoading(false);
    }
  };

  const handleMatchCancel = () => {
    setShowMatchForm(false);
    setMatchingTransfer(null);
    setExpandedRows(new Set());
    setMatchFormData({
      from_bank: '',
      to_bank: '',
      amount_inr: '',
      date: '01/01/2023',
      utr: '',
      notes: ''
    });
  };

  const updateMatchFormData = (field, value) => {
    setMatchFormData({
      ...matchFormData,
      [field]: value
    });
  };

  const updateFormData = (field, value) => {
    setFormData({
      ...formData,
      [field]: value
    });
  };

  // Tag management functions
  const handleTagSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (editingTag) {
        // For editing, check if the new name conflicts with other tags (excluding current tag)
        if (tagFormData.name !== editingTag.name) {
          const { data: existingTag } = await supabase
            .from('tags')
            .select('id')
            .eq('name', tagFormData.name)
            .neq('id', editingTag.id)
            .single();

          if (existingTag) {
            throw new Error(`A bank tag with the name "${tagFormData.name}" already exists. Please use a different name.`);
          }
        }

        const { error } = await supabase
          .from('tags')
          .update(tagFormData)
          .eq('id', editingTag.id);

        if (error) throw error;
        setMessage('Bank tag updated successfully');
      } else {
        // For new tags, check if name already exists
        const { data: existingTag } = await supabase
          .from('tags')
          .select('id')
          .eq('name', tagFormData.name)
          .single();

        if (existingTag) {
          throw new Error(`A bank tag with the name "${tagFormData.name}" already exists. Please use a different name.`);
        }

        const { error } = await supabase
          .from('tags')
          .insert([tagFormData]);

        if (error) {
          // Handle specific error for duplicate tag names
          if (error.code === '23505' && error.message.includes('tags_name_key')) {
            throw new Error(`A bank tag with the name "${tagFormData.name}" already exists. Please use a different name.`);
          }
          throw error;
        }
        setMessage('Bank tag added successfully');
      }

      setTagFormData({ name: '', color: '#3B82F6' });
      setShowTagForm(false);
      setEditingTag(null);
      fetchData();
    } catch (error) {
      console.error('Error saving bank tag:', error);
      setMessage(error.message || 'Error saving bank tag');
    } finally {
      setLoading(false);
    }
  };

  const handleEditTag = (tag) => {
    setEditingTag(tag);
    setTagFormData({
      name: tag.name || '',
      color: tag.color || '#3B82F6'
    });
    setShowTagForm(true);
  };

  const handleDeleteTag = async (id) => {
    if (!window.confirm('Are you sure you want to delete this bank tag? This will remove it from all transfers.')) return;

    try {
      const { error } = await supabase
        .from('tags')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setMessage('Bank tag deleted successfully');
      fetchData();
    } catch (error) {
      console.error('Error deleting bank tag:', error);
      setMessage('Error deleting bank tag');
    }
  };

  const handleCancelTag = () => {
    setShowTagForm(false);
    setEditingTag(null);
    setTagFormData({ name: '', color: '#3B82F6' });
  };

  // CSV Upload functions
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type === 'text/csv') {
      setCsvFile(file);
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const processedData = results.data.map((row, index) => ({
            from_bank: row.from_bank || row['From Bank'] || '',
            to_bank: row.to_bank || row['To Bank'] || '',
            amount_inr: row.amount_inr || row['Amount'] || row['Amount (INR)'] || '',
            date: row.date || row['Date'] || '',
            utr: row.utr || row['UTR'] || '',
            notes: row.notes || row['Notes'] || ''
          }));
          setCsvData(processedData);
          setShowBulkEditor(true);
        },
        error: (error) => {
          setMessage('Error parsing CSV file: ' + error.message);
        }
      });
    } else {
      setMessage('Please select a valid CSV file');
    }
  };

  const handleBulkEditorSave = (count) => {
    setMessage(`Successfully imported ${count} inter bank transfer(s)`);
    setShowCsvUpload(false);
    setShowBulkEditor(false);
    setCsvData([]);
    setCsvFile(null);
    fetchData();
  };

  const handleBulkEditorCancel = () => {
    setShowCsvUpload(false);
    setShowBulkEditor(false);
    setCsvData([]);
    setCsvFile(null);
  };

  const addBankToDropdown = (bankName, type) => {
    if (type === 'from') {
      if (!fromBanks.includes(bankName)) {
        setFromBanks([...fromBanks, bankName].sort());
      }
    } else {
      if (!toBanks.includes(bankName)) {
        setToBanks([...toBanks, bankName].sort());
      }
    }
  };

  const downloadSampleCSV = () => {
    const sampleData = [
      {
        'From Bank': 'ICICI Sri',
        'To Bank': 'IDFC GG',
        'Amount': '1000',
        'Date': '27-Feb-23',
        'UTR': 'UTR123456',
        'Notes': 'Transfer for business'
      },
      {
        'From Bank': 'IDFC GG',
        'To Bank': 'ICICI Sri',
        'Amount': '1000',
        'Date': '27-Feb-23',
        'UTR': 'UTR123456',
        'Notes': 'Transfer for business'
      },
      {
        'From Bank': 'HDFC Bank',
        'To Bank': 'SBI Bank',
        'Amount': '50000',
        'Date': '15-Mar-23',
        'UTR': 'UTR789012',
        'Notes': 'Monthly transfer'
      },
      {
        'From Bank': 'SBI Bank',
        'To Bank': 'HDFC Bank',
        'Amount': '50000',
        'Date': '15-Mar-23',
        'UTR': 'UTR789012',
        'Notes': 'Monthly transfer'
      }
    ];

    const csv = Papa.unparse(sampleData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'sample_inter_bank_transfers.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const cleanAllUtrs = async () => {
    if (!window.confirm('This will clean all UTRs in the database by removing commas. Continue?')) return;
    
    setLoading(true);
    try {
      // Get all transfers with UTRs that contain commas
      const { data: transfersWithCommas, error: fetchError } = await supabase
        .from('inter_bank_transfers')
        .select('id, utr')
        .not('utr', 'is', null)
        .like('utr', '%,%');

      if (fetchError) throw fetchError;

      if (transfersWithCommas.length === 0) {
        setMessage('No UTRs with commas found to clean');
        return;
      }

      // Update each transfer with cleaned UTR
      let updatedCount = 0;
      for (const transfer of transfersWithCommas) {
        const cleanedUtr = transfer.utr.replace(/,/g, '');
        const { error: updateError } = await supabase
          .from('inter_bank_transfers')
          .update({ utr: cleanedUtr })
          .eq('id', transfer.id);

        if (updateError) {
          console.error('Error updating transfer:', transfer.id, updateError);
        } else {
          updatedCount++;
        }
      }

      setMessage(`Successfully cleaned ${updatedCount} UTR(s) by removing commas`);
      fetchData(); // Refresh the data
    } catch (error) {
      console.error('Error cleaning UTRs:', error);
      setMessage('Error cleaning UTRs. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const cleanSingleUtr = async (transferId, currentUtr) => {
    if (!window.confirm(`Clean UTR "${currentUtr}" by removing commas?`)) return;
    
    setLoading(true);
    try {
      const cleanedUtr = currentUtr.replace(/,/g, '');
      const { error } = await supabase
        .from('inter_bank_transfers')
        .update({ utr: cleanedUtr })
        .eq('id', transferId);

      if (error) throw error;

      setMessage(`Successfully cleaned UTR: ${currentUtr} → ${cleanedUtr}`);
      fetchData(); // Refresh the data
    } catch (error) {
      console.error('Error cleaning UTR:', error);
      setMessage('Error cleaning UTR. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const switchBanks = async (transferId, fromBank, toBank) => {
    if (!window.confirm(`Switch banks from "${fromBank}" to "${toBank}"?`)) return;
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('inter_bank_transfers')
        .update({ 
          from_bank: toBank,
          to_bank: fromBank
        })
        .eq('id', transferId);

      if (error) throw error;

      setMessage(`Successfully switched banks: ${fromBank} ↔ ${toBank}`);
      fetchData(); // Refresh the data
    } catch (error) {
      console.error('Error switching banks:', error);
      setMessage('Error switching banks. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const predefinedColors = [
    '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4',
    '#DC2626', '#059669', '#7C3AED', '#EA580C', '#BE185D',
    '#0891B2', '#7C2D12', '#1E40AF'
  ];

  if (loading && transfers.length === 0) {
    return (
      <div className="card">
        <h2>Loading inter bank transfers...</h2>
      </div>
    );
  }

  return (
    <div>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
         <h2>Inter Bank Transfers</h2>
         <div>
           <button onClick={() => setShowTagForm(true)} className="btn btn-secondary" style={{ marginRight: '0.5rem' }}>
             Manage Bank Tags
           </button>
           <button onClick={() => setShowCsvUpload(true)} className="btn btn-secondary" style={{ marginRight: '0.5rem' }}>
             CSV Bulk Upload
           </button>
           <button onClick={cleanAllUtrs} className="btn btn-secondary" style={{ marginRight: '0.5rem' }}>
             Clean All UTRs
           </button>
           <button onClick={() => setShowForm(true)} className="btn btn-primary">
             Add Transfer
           </button>
         </div>
       </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem' }}>{editingTransfer ? 'Edit Transfer' : 'Add New Transfer'}</h3>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group" style={{ marginBottom: '0' }}>
                <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>From Bank *</label>
                <select
                  value={formData.from_bank}
                  onChange={(e) => updateFormData('from_bank', e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                  required
                >
                  <option value="">Select From Bank</option>
                  {bankTags.map((tag) => (
                    <option key={tag.id} value={tag.name}>
                      {tag.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Or type new bank name"
                  onChange={(e) => addBankToDropdown(e.target.value, 'from')}
                  style={{ width: '100%', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem', marginTop: '0.25rem' }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: '0' }}>
                <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>To Bank *</label>
                <select
                  value={formData.to_bank}
                  onChange={(e) => updateFormData('to_bank', e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                  required
                >
                  <option value="">Select To Bank</option>
                  {bankTags.map((tag) => (
                    <option key={tag.id} value={tag.name}>
                      {tag.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Or type new bank name"
                  onChange={(e) => addBankToDropdown(e.target.value, 'to')}
                  style={{ width: '100%', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem', marginTop: '0.25rem' }}
                />
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group" style={{ marginBottom: '0' }}>
                <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>Amount (INR) *</label>
                <input
                  type="number"
                  value={formData.amount_inr}
                  onChange={(e) => updateFormData('amount_inr', e.target.value)}
                  step="0.01"
                  min="0"
                  required
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                  placeholder="0.00"
                />
              </div>
              <div className="form-group" style={{ marginBottom: '0' }}>
                <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>Date *</label>
                <input
                  type="text"
                  value={formData.date}
                  onChange={(e) => updateFormData('date', e.target.value)}
                  placeholder="DD/MM/YYYY"
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                  required
                />
              </div>
            </div>
            
                         <div className="form-group" style={{ marginBottom: '0' }}>
               <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>UTR Number</label>
               <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                 <input
                   type="text"
                   value={formData.utr}
                   onChange={(e) => updateFormData('utr', e.target.value)}
                   style={{ flex: 1, padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                   placeholder="UTR123456789"
                 />
                 <button
                   type="button"
                   onClick={() => updateFormData('utr', formData.utr.replace(/,/g, ''))}
                   className="btn btn-secondary"
                   style={{ padding: '0.5rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                   title="Remove commas from UTR"
                 >
                   Clean UTR
                 </button>
               </div>
             </div>
            
            <div className="form-group" style={{ marginBottom: '0' }}>
              <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => updateFormData('notes', e.target.value)}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', minHeight: '60px', resize: 'vertical', fontSize: '0.9rem' }}
                placeholder="Optional notes for this transfer..."
              />
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="submit" className="btn btn-success" disabled={loading} style={{ flex: 1, padding: '0.5rem' }}>
                {loading ? 'Saving...' : (editingTransfer ? 'Update' : 'Save')}
              </button>
              <button type="button" onClick={handleCancel} className="btn btn-secondary" style={{ padding: '0.5rem' }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Match Form */}
      {showMatchForm && (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem' }}>
            Add Match Transfer for: {matchingTransfer?.from_bank} → {matchingTransfer?.to_bank} (₹{matchingTransfer?.amount_inr?.toLocaleString()})
          </h3>
          <form onSubmit={handleMatchSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group" style={{ marginBottom: '0' }}>
                <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>From Bank *</label>
                <select
                  value={matchFormData.from_bank}
                  onChange={(e) => updateMatchFormData('from_bank', e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                  required
                >
                  <option value="">Select From Bank</option>
                  {bankTags.map((tag) => (
                    <option key={tag.id} value={tag.name}>
                      {tag.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Or type new bank name"
                  onChange={(e) => addBankToDropdown(e.target.value, 'from')}
                  style={{ width: '100%', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem', marginTop: '0.25rem' }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: '0' }}>
                <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>To Bank *</label>
                <select
                  value={matchFormData.to_bank}
                  onChange={(e) => updateMatchFormData('to_bank', e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                  required
                >
                  <option value="">Select To Bank</option>
                  {bankTags.map((tag) => (
                    <option key={tag.id} value={tag.name}>
                      {tag.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Or type new bank name"
                  onChange={(e) => addBankToDropdown(e.target.value, 'to')}
                  style={{ width: '100%', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem', marginTop: '0.25rem' }}
                />
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="form-group" style={{ marginBottom: '0' }}>
                <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>Amount (INR) *</label>
                <input
                  type="number"
                  value={matchFormData.amount_inr}
                  onChange={(e) => updateMatchFormData('amount_inr', e.target.value)}
                  step="0.01"
                  min="0"
                  required
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                  placeholder="0.00"
                />
              </div>
              <div className="form-group" style={{ marginBottom: '0' }}>
                <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>Date *</label>
                <input
                  type="text"
                  value={matchFormData.date}
                  onChange={(e) => updateMatchFormData('date', e.target.value)}
                  placeholder="DD/MM/YYYY"
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                  required
                />
              </div>
            </div>
            
            <div className="form-group" style={{ marginBottom: '0' }}>
              <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>UTR Number</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                <input
                  type="text"
                  value={matchFormData.utr}
                  onChange={(e) => updateMatchFormData('utr', e.target.value)}
                  style={{ flex: 1, padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                  placeholder="UTR123456789"
                />
                <button
                  type="button"
                  onClick={() => updateMatchFormData('utr', matchFormData.utr.replace(/,/g, ''))}
                  className="btn btn-secondary"
                  style={{ padding: '0.5rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                  title="Remove commas from UTR"
                >
                  Clean UTR
                </button>
              </div>
            </div>
            
            <div className="form-group" style={{ marginBottom: '0' }}>
              <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>Notes</label>
              <textarea
                value={matchFormData.notes}
                onChange={(e) => updateMatchFormData('notes', e.target.value)}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', minHeight: '60px', resize: 'vertical', fontSize: '0.9rem' }}
                placeholder="Optional notes for this match transfer..."
              />
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="submit" className="btn btn-success" disabled={loading} style={{ flex: 1, padding: '0.5rem' }}>
                {loading ? 'Saving Match...' : 'Save Match'}
              </button>
              <button type="button" onClick={handleMatchCancel} className="btn btn-secondary" style={{ padding: '0.5rem' }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bank Tags Management Form */}
      {showTagForm && (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto', marginBottom: '1rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem' }}>{editingTag ? 'Edit Bank Tag' : 'Add New Bank Tag'}</h3>
          <form onSubmit={handleTagSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
            <div className="form-group" style={{ marginBottom: '0' }}>
              <label htmlFor="tag_name" style={{ fontSize: '0.9rem', marginBottom: '0.25rem' }}>Bank Tag Name *</label>
              <input
                type="text"
                id="tag_name"
                value={tagFormData.name}
                onChange={(e) => setTagFormData({ ...tagFormData, name: e.target.value })}
                placeholder="e.g., HDFC Bank, SBI Bank"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                required
              />
            </div>
            <div className="form-group" style={{ marginBottom: '0' }}>
              <label htmlFor="tag_color" style={{ fontSize: '0.9rem', marginBottom: '0.25rem' }}>Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <input
                  type="color"
                  id="tag_color"
                  value={tagFormData.color}
                  onChange={(e) => setTagFormData({ ...tagFormData, color: e.target.value })}
                  style={{ width: '50px', height: '40px', border: 'none', borderRadius: '4px' }}
                />
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {predefinedColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setTagFormData({ ...tagFormData, color })}
                      style={{
                        width: '30px',
                        height: '30px',
                        backgroundColor: color,
                        border: '2px solid #ddd',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        borderColor: tagFormData.color === color ? '#333' : '#ddd'
                      }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="submit" className="btn btn-success" disabled={loading} style={{ flex: 1, padding: '0.5rem' }}>
                {loading ? 'Saving...' : (editingTag ? 'Update' : 'Save')}
              </button>
              <button type="button" onClick={handleCancelTag} className="btn btn-secondary" style={{ padding: '0.5rem' }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bank Tags Display - Only show when Manage Bank Tags is clicked */}
      {showTagForm && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Available Bank Tags</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
            {bankTags.map((tag) => (
              <div
                key={tag.id}
                className="card"
                style={{
                  border: `2px solid ${tag.color}`,
                  borderRadius: '8px',
                  padding: '1rem',
                  position: 'relative'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: '0 0 0.5rem 0', color: tag.color }}>
                      {tag.name}
                    </h4>
                    <p style={{ margin: '0', fontSize: '0.9rem', color: '#666' }}>
                      Color: {tag.color}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => handleEditTag(tag)} className="btn btn-primary btn-sm">
                      Edit
                    </button>
                    <button onClick={() => handleDeleteTag(tag.id)} className="btn btn-danger btn-sm">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {bankTags.length === 0 && <p style={{ textAlign: 'center', color: '#666', padding: '1rem' }}>No bank tags found. Create your first bank tag to get started!</p>}
        </div>
      )}

      {/* CSV Upload Form */}
      {showCsvUpload && !showBulkEditor && (
        <div className="card" style={{ maxWidth: '800px', margin: '0 auto', marginBottom: '1rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem' }}>CSV Bulk Upload Inter Bank Transfers</h3>
          
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <h4>Upload CSV File</h4>
                             <p style={{ color: '#666', marginBottom: '1rem' }}>
                 Upload a CSV file with the following columns: From Bank, To Bank, Amount, Date (MM-DD-YYYY format), UTR (optional), Notes (optional)
               </p>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                style={{ marginBottom: '1rem' }}
              />
            </div>
            
            <div style={{ textAlign: 'left', maxWidth: '600px', margin: '0 auto' }}>
              <h5>CSV Format Example:</h5>
                             <pre style={{ backgroundColor: '#f8f9fa', padding: '1rem', borderRadius: '4px', fontSize: '0.9rem' }}>
 {`From Bank,To Bank,Amount,Date,UTR,Notes
 ICICI Sri,IDFC GG,1000,27-Feb-23,UTR123456,Transfer for business
 IDFC GG,ICICI Sri,1000,27-Feb-23,UTR123456,Transfer for business
 HDFC Bank,SBI Bank,50000,15-Mar-23,UTR789012,Monthly transfer
 SBI Bank,HDFC Bank,50000,15-Mar-23,UTR789012,Monthly transfer`}
               </pre>
              <button onClick={downloadSampleCSV} className="btn btn-secondary btn-sm" style={{ marginTop: '1rem' }}>
                Download Sample CSV
              </button>
            </div>
          </div>
        </div>
      )}

             {/* Bulk Editor */}
       {showBulkEditor && (
         <InterBankTransfersBulkEditor
           csvData={csvData}
           onSave={handleBulkEditorSave}
           onCancel={handleBulkEditorCancel}
           bankTags={bankTags}
         />
       )}

       {/* Transfer Matching Summary */}
       <div className="card" style={{ marginBottom: '1rem' }}>
         <h3 style={{ marginBottom: '1rem' }}>Transfer Matching Summary</h3>
         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                       <div style={{ 
              padding: '1rem', 
              backgroundColor: '#f0f9ff', 
              border: '2px solid #0ea5e9', 
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#0ea5e9' }}>Perfect Matches</h4>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '0', color: '#0ea5e9' }}>
                {transfers.filter(t => t.matchStatus === 'perfect-match').length}
              </p>
              <p style={{ fontSize: '1rem', margin: '0.5rem 0 0 0', color: '#0ea5e9' }}>
                ₹{transfers.filter(t => t.matchStatus === 'perfect-match' && t.transferType === 'sent').reduce((sum, t) => sum + t.amount_inr, 0).toLocaleString()}
              </p>
            </div>
           <div style={{ 
             padding: '1rem', 
             backgroundColor: '#fef3c7', 
             border: '2px solid #f59e0b', 
             borderRadius: '8px',
             textAlign: 'center'
           }}>
             <h4 style={{ margin: '0 0 0.5rem 0', color: '#f59e0b' }}>Mismatches</h4>
             <p style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '0', color: '#f59e0b' }}>
               {transfers.filter(t => t.matchStatus === 'mismatch').length}
             </p>
             <p style={{ fontSize: '1rem', margin: '0.5rem 0 0 0', color: '#f59e0b' }}>
               ₹{transfers.filter(t => t.matchStatus === 'mismatch').reduce((sum, t) => sum + t.amount_inr, 0).toLocaleString()}
             </p>
           </div>
           <div style={{ 
             padding: '1rem', 
             backgroundColor: '#fef2f2', 
             border: '2px solid #dc2626', 
             borderRadius: '8px',
             textAlign: 'center'
           }}>
             <h4 style={{ margin: '0 0 0.5rem 0', color: '#dc2626' }}>No Matches</h4>
             <p style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '0', color: '#dc2626' }}>
               {transfers.filter(t => t.matchStatus === 'no-match').length}
             </p>
             <p style={{ fontSize: '1rem', margin: '0.5rem 0 0 0', color: '#dc2626' }}>
               ₹{transfers.filter(t => t.matchStatus === 'no-match').reduce((sum, t) => sum + t.amount_inr, 0).toLocaleString()}
             </p>
           </div>
           <div style={{ 
             padding: '1rem', 
             backgroundColor: '#f3f4f6', 
             border: '2px solid #6b7280', 
             borderRadius: '8px',
             textAlign: 'center'
           }}>
             <h4 style={{ margin: '0 0 0.5rem 0', color: '#6b7280' }}>Total Transfers</h4>
             <p style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '0', color: '#6b7280' }}>
               {transfers.length}
             </p>
             <p style={{ fontSize: '1rem', margin: '0.5rem 0 0 0', color: '#6b7280' }}>
               ₹{transfers.reduce((sum, t) => sum + t.amount_inr, 0).toLocaleString()}
             </p>
           </div>
         </div>
         
         {/* Additional Summary Stats */}
         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
           <div style={{ 
             padding: '1rem', 
             backgroundColor: '#f0fdf4', 
             border: '2px solid #16a34a', 
             borderRadius: '8px',
             textAlign: 'center'
           }}>
             <h4 style={{ margin: '0 0 0.5rem 0', color: '#16a34a' }}>Complex Transfers</h4>
             <p style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '0', color: '#16a34a' }}>
               {transfers.filter(t => t.matchStatus === 'complex').length}
             </p>
             <p style={{ fontSize: '1rem', margin: '0.5rem 0 0 0', color: '#16a34a' }}>
               ₹{transfers.filter(t => t.matchStatus === 'complex').reduce((sum, t) => sum + t.amount_inr, 0).toLocaleString()}
             </p>
           </div>
           <div style={{ 
             padding: '1rem', 
             backgroundColor: '#fef7ff', 
             border: '2px solid #9333ea', 
             borderRadius: '8px',
             textAlign: 'center'
           }}>
             <h4 style={{ margin: '0 0 0.5rem 0', color: '#9333ea' }}>Unique Groups</h4>
             <p style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '0', color: '#9333ea' }}>
               {new Set(transfers.map(t => t.groupId)).size}
             </p>
             <p style={{ fontSize: '0.9rem', margin: '0.5rem 0 0 0', color: '#9333ea' }}>
               Transfer Groups
             </p>
           </div>
                       <div style={{ 
              padding: '1rem', 
              backgroundColor: '#fffbeb', 
              border: '2px solid #d97706', 
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#d97706' }}>Matched Amount</h4>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '0', color: '#d97706' }}>
                ₹{(transfers.filter(t => (t.matchStatus === 'perfect-match' && t.transferType === 'sent') || (t.matchStatus === 'mismatch' && t.transferType === 'sent')).reduce((sum, t) => sum + t.amount_inr, 0)).toLocaleString()}
              </p>
              <p style={{ fontSize: '0.9rem', margin: '0.5rem 0 0 0', color: '#d97706' }}>
                (Sent transfers only)
              </p>
            </div>
         </div>
       </div>

               <div className="card">
          <table className="table" style={{ fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={{ padding: '0.5rem' }}>Type</th>
                <th style={{ padding: '0.5rem' }}>From Bank</th>
                <th style={{ padding: '0.5rem' }}>To Bank</th>
                <th style={{ padding: '0.5rem' }}>Amount</th>
                <th 
                  style={{ padding: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSort('date')}
                  title="Click to sort by date"
                >
                  Date {getSortIcon('date')}
                </th>
                <th 
                  style={{ padding: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSort('utr')}
                  title="Click to sort by UTR"
                >
                  UTR {getSortIcon('utr')}
                </th>
                <th style={{ padding: '0.5rem' }}>Match Status</th>
                <th style={{ padding: '0.5rem' }}>Notes</th>
                <th style={{ padding: '0.5rem' }}>Actions</th>
              </tr>
            </thead>
                                                                                               <tbody>
                                {sortData(transfers).map((transfer, index) => {
                  const sortedTransfers = sortData(transfers);
                  const isFirstInGroup = index === 0 || sortedTransfers[index - 1].groupId !== transfer.groupId;
                  const isLastInGroup = index === sortedTransfers.length - 1 || sortedTransfers[index + 1].groupId !== transfer.groupId;
                 const hasMatchingTransfer = transfer.matchingTransfer !== null;
                 const isEditing = editingTransfer && editingTransfer.id === transfer.id;
                 
                 return (
                   <React.Fragment key={transfer.id}>
                     <tr style={{
                       backgroundColor: transfer.matchStatus === 'perfect-match' ? '#f0f9ff' : 
                                      transfer.matchStatus === 'mismatch' ? '#fef3c7' : 
                                      transfer.matchStatus === 'no-match' ? '#fef2f2' : '#f3f4f6',
                       borderTop: isFirstInGroup ? '2px solid #e5e7eb' : 'none',
                       borderBottom: isLastInGroup ? '2px solid #e5e7eb' : '1px solid #f3f4f6'
                     }}>
                       <td style={{ padding: '0.5rem' }}>
                         <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                           <span style={{
                             padding: '0.25rem 0.5rem',
                             borderRadius: '4px',
                             fontSize: '0.75rem',
                             fontWeight: 'bold',
                             backgroundColor: transfer.transferType === 'sent' ? '#dc2626' : 
                                            transfer.transferType === 'received' ? '#059669' : '#6b7280',
                             color: 'white'
                           }}>
                             {transfer.transferType === 'sent' ? 'SENT' : 
                              transfer.transferType === 'received' ? 'RECEIVED' : 'TRANSFER'}
                           </span>
                           {hasMatchingTransfer && (
                             <span style={{
                               fontSize: '0.7rem',
                               color: '#6b7280',
                               backgroundColor: '#f3f4f6',
                               padding: '0.1rem 0.3rem',
                               borderRadius: '3px'
                             }}>
                               {transfer.displayOrder === 1 ? '1/2' : '2/2'}
                             </span>
                           )}
                         </div>
                       </td>
                       <td style={{ padding: '0.5rem' }}>{transfer.from_bank}</td>
                       <td style={{ padding: '0.5rem' }}>{transfer.to_bank}</td>
                       <td style={{ padding: '0.5rem' }} className="positive">₹{transfer.amount_inr.toLocaleString()}</td>
                       <td style={{ padding: '0.5rem' }}>{format(new Date(transfer.date), 'MMM dd, yyyy')}</td>
                       <td style={{ padding: '0.5rem' }}>{transfer.utr || '-'}</td>
                       <td style={{ padding: '0.5rem' }}>
                         {transfer.matchStatus === 'perfect-match' && (
                           <span style={{ color: '#059669', fontWeight: 'bold' }}>✅ Perfect Match</span>
                         )}
                         {transfer.matchStatus === 'mismatch' && (
                           <div>
                             <span style={{ color: '#dc2626', fontWeight: 'bold' }}>
                               ⚠️ Mismatch
                             </span>
                             <div style={{ fontSize: '0.75rem', color: '#dc2626' }}>
                               {transfer.matchAmount > 0 ? '+' : ''}₹{transfer.matchAmount.toLocaleString()}
                             </div>
                           </div>
                         )}
                         {transfer.matchStatus === 'no-match' && (
                           <span style={{ color: '#6b7280', fontWeight: 'bold' }}>❌ No Match</span>
                         )}
                         {transfer.matchStatus === 'complex' && (
                           <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>🔄 Complex</span>
                         )}
                       </td>
                       <td style={{ padding: '0.5rem' }}>{transfer.notes || '-'}</td>
                       <td style={{ padding: '0.5rem' }} className="actions">
                         {isEditing ? (
                           <>
                             <button onClick={handleSubmit} className="btn btn-success btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }} disabled={loading}>
                               {loading ? 'Saving...' : 'Save'}
                             </button>
                             <button onClick={handleCancel} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginLeft: '0.25rem' }}>
                               Cancel
                             </button>
                           </>
                         ) : (
                           <>
                             <button onClick={() => handleEdit(transfer)} className="btn btn-primary btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>
                               Edit
                             </button>
                             <button onClick={() => handleDelete(transfer.id)} className="btn btn-danger btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginLeft: '0.25rem' }}>
                               Delete
                             </button>
                             {transfer.matchStatus === 'no-match' && (
                               <button 
                                 onClick={() => handleMatch(transfer)} 
                                 className="btn btn-success btn-sm" 
                                 style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginLeft: '0.25rem' }}
                                 title="Add matching transfer"
                               >
                                 Match
                               </button>
                             )}
                                                           {transfer.utr && transfer.utr.includes(',') && (
                                <button 
                                  onClick={() => cleanSingleUtr(transfer.id, transfer.utr)} 
                                  className="btn btn-warning btn-sm" 
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginLeft: '0.25rem' }}
                                  title="Remove commas from UTR"
                                >
                                  Clean UTR
                                </button>
                              )}
                              {transfer.matchStatus === 'mismatch' && (
                                <button 
                                  onClick={() => switchBanks(transfer.id, transfer.from_bank, transfer.to_bank)} 
                                  className="btn btn-info btn-sm" 
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginLeft: '0.25rem' }}
                                  title="Switch from and to banks to resolve mismatch"
                                >
                                  Switch Banks
                                </button>
                              )}
                           </>
                         )}
                       </td>
                     </tr>
                     
                     {/* Inline Edit Form */}
                     {isEditing && (
                       <tr>
                         <td colSpan="9" style={{ padding: '0', backgroundColor: '#f8f9fa' }}>
                           <div style={{ padding: '1rem', borderTop: '2px solid #e5e7eb' }}>
                             <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: '#374151' }}>Edit Transfer</h4>
                             <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
                               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                 <div className="form-group" style={{ marginBottom: '0' }}>
                                   <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>From Bank *</label>
                                   <select
                                     value={formData.from_bank}
                                     onChange={(e) => updateFormData('from_bank', e.target.value)}
                                     style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                                     required
                                   >
                                     <option value="">Select From Bank</option>
                                     {bankTags.map((tag) => (
                                       <option key={tag.id} value={tag.name}>
                                         {tag.name}
                                       </option>
                                     ))}
                                   </select>
                                   <input
                                     type="text"
                                     placeholder="Or type new bank name"
                                     onChange={(e) => addBankToDropdown(e.target.value, 'from')}
                                     style={{ width: '100%', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem', marginTop: '0.25rem' }}
                                   />
                                 </div>
                                 <div className="form-group" style={{ marginBottom: '0' }}>
                                   <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>To Bank *</label>
                                   <select
                                     value={formData.to_bank}
                                     onChange={(e) => updateFormData('to_bank', e.target.value)}
                                     style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                                     required
                                   >
                                     <option value="">Select To Bank</option>
                                     {bankTags.map((tag) => (
                                       <option key={tag.id} value={tag.name}>
                                         {tag.name}
                                       </option>
                                     ))}
                                   </select>
                                   <input
                                     type="text"
                                     placeholder="Or type new bank name"
                                     onChange={(e) => addBankToDropdown(e.target.value, 'to')}
                                     style={{ width: '100%', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem', marginTop: '0.25rem' }}
                                   />
                                 </div>
                               </div>
                               
                               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                 <div className="form-group" style={{ marginBottom: '0' }}>
                                   <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>Amount (INR) *</label>
                                   <input
                                     type="number"
                                     value={formData.amount_inr}
                                     onChange={(e) => updateFormData('amount_inr', e.target.value)}
                                     step="0.01"
                                     min="0"
                                     required
                                     style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                                     placeholder="0.00"
                                   />
                                 </div>
                                 <div className="form-group" style={{ marginBottom: '0' }}>
                                   <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>Date *</label>
                                   <input
                                     type="text"
                                     value={formData.date}
                                     onChange={(e) => updateFormData('date', e.target.value)}
                                     placeholder="DD/MM/YYYY"
                                     style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                                     required
                                   />
                                 </div>
                               </div>
                               
                               <div className="form-group" style={{ marginBottom: '0' }}>
                                 <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>UTR Number</label>
                                 <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                                   <input
                                     type="text"
                                     value={formData.utr}
                                     onChange={(e) => updateFormData('utr', e.target.value)}
                                     style={{ flex: 1, padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                                     placeholder="UTR123456789"
                                   />
                                   <button
                                     type="button"
                                     onClick={() => updateFormData('utr', formData.utr.replace(/,/g, ''))}
                                     className="btn btn-secondary"
                                     style={{ padding: '0.5rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                                     title="Remove commas from UTR"
                                   >
                                     Clean UTR
                                   </button>
                                 </div>
                               </div>
                               
                               <div className="form-group" style={{ marginBottom: '0' }}>
                                 <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>Notes</label>
                                 <textarea
                                   value={formData.notes}
                                   onChange={(e) => updateFormData('notes', e.target.value)}
                                   style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', minHeight: '60px', resize: 'vertical', fontSize: '0.9rem' }}
                                   placeholder="Optional notes for this transfer..."
                                 />
                               </div>
                             </form>
                           </div>
                         </td>
                       </tr>
                     )}

                     {/* Inline Match Form */}
                     {showMatchForm && matchingTransfer && matchingTransfer.id === transfer.id && (
                       <tr>
                         <td colSpan="9" style={{ padding: '0', backgroundColor: '#f0f9ff' }}>
                           <div style={{ padding: '1rem', borderTop: '2px solid #0ea5e9' }}>
                             <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: '#0ea5e9' }}>
                               Add Match Transfer for: {matchingTransfer.from_bank} → {matchingTransfer.to_bank} (₹{matchingTransfer.amount_inr.toLocaleString()})
                             </h4>
                             <form onSubmit={handleMatchSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
                               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                 <div className="form-group" style={{ marginBottom: '0' }}>
                                   <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>From Bank *</label>
                                   <select
                                     value={matchFormData.from_bank}
                                     onChange={(e) => updateMatchFormData('from_bank', e.target.value)}
                                     style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                                     required
                                   >
                                     <option value="">Select From Bank</option>
                                     {bankTags.map((tag) => (
                                       <option key={tag.id} value={tag.name}>
                                         {tag.name}
                                       </option>
                                     ))}
                                   </select>
                                   <input
                                     type="text"
                                     placeholder="Or type new bank name"
                                     onChange={(e) => addBankToDropdown(e.target.value, 'from')}
                                     style={{ width: '100%', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem', marginTop: '0.25rem' }}
                                   />
                                 </div>
                                 <div className="form-group" style={{ marginBottom: '0' }}>
                                   <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>To Bank *</label>
                                   <select
                                     value={matchFormData.to_bank}
                                     onChange={(e) => updateMatchFormData('to_bank', e.target.value)}
                                     style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                                     required
                                   >
                                     <option value="">Select To Bank</option>
                                     {bankTags.map((tag) => (
                                       <option key={tag.id} value={tag.name}>
                                         {tag.name}
                                       </option>
                                     ))}
                                   </select>
                                   <input
                                     type="text"
                                     placeholder="Or type new bank name"
                                     onChange={(e) => addBankToDropdown(e.target.value, 'to')}
                                     style={{ width: '100%', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem', marginTop: '0.25rem' }}
                                   />
                                 </div>
                               </div>
                               
                               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                 <div className="form-group" style={{ marginBottom: '0' }}>
                                   <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>Amount (INR) *</label>
                                   <input
                                     type="number"
                                     value={matchFormData.amount_inr}
                                     onChange={(e) => updateMatchFormData('amount_inr', e.target.value)}
                                     step="0.01"
                                     min="0"
                                     required
                                     style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                                     placeholder="0.00"
                                   />
                                 </div>
                                 <div className="form-group" style={{ marginBottom: '0' }}>
                                   <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>Date *</label>
                                   <input
                                     type="text"
                                     value={matchFormData.date}
                                     onChange={(e) => updateMatchFormData('date', e.target.value)}
                                     placeholder="DD/MM/YYYY"
                                     style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                                     required
                                   />
                                 </div>
                               </div>
                               
                               <div className="form-group" style={{ marginBottom: '0' }}>
                                 <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>UTR Number</label>
                                 <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                                   <input
                                     type="text"
                                     value={matchFormData.utr}
                                     onChange={(e) => updateMatchFormData('utr', e.target.value)}
                                     style={{ flex: 1, padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                                     placeholder="UTR123456789"
                                   />
                                   <button
                                     type="button"
                                     onClick={() => updateMatchFormData('utr', matchFormData.utr.replace(/,/g, ''))}
                                     className="btn btn-secondary"
                                     style={{ padding: '0.5rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                                     title="Remove commas from UTR"
                                   >
                                     Clean UTR
                                   </button>
                                 </div>
                               </div>
                               
                               <div className="form-group" style={{ marginBottom: '0' }}>
                                 <label style={{ fontSize: '0.9rem', marginBottom: '0.25rem', display: 'block' }}>Notes</label>
                                 <textarea
                                   value={matchFormData.notes}
                                   onChange={(e) => updateMatchFormData('notes', e.target.value)}
                                   style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', minHeight: '60px', resize: 'vertical', fontSize: '0.9rem' }}
                                   placeholder="Optional notes for this match transfer..."
                                 />
                               </div>
                               
                               <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                 <button type="submit" className="btn btn-success" disabled={loading} style={{ flex: 1, padding: '0.5rem' }}>
                                   {loading ? 'Saving Match...' : 'Save Match'}
                                 </button>
                                 <button type="button" onClick={handleMatchCancel} className="btn btn-secondary" style={{ padding: '0.5rem' }}>
                                   Cancel
                                 </button>
                               </div>
                             </form>
                           </div>
                         </td>
                       </tr>
                     )}
                   </React.Fragment>
                 );
               })}
             </tbody>
         </table>
         {transfers.length === 0 && <p style={{ textAlign: 'center', color: '#666', padding: '1rem' }}>No inter bank transfers found</p>}
       </div>
    </div>
  );
}

export default InterBankTransfers;
