import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';

function Tags() {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTag, setEditingTag] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    color: '#3B82F6'
  });
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchTags();
  }, []);

  const fetchTags = async () => {
    try {
      const { data, error } = await supabase
        .from('tags')
        .select('*')
        .order('name');

      if (error) throw error;
      setTags(data || []);
    } catch (error) {
      console.error('Error fetching tags:', error);
      setMessage('Error fetching tags');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (editingTag) {
        const { error } = await supabase
          .from('tags')
          .update(formData)
          .eq('id', editingTag.id);

        if (error) throw error;
        setMessage('Tag updated successfully');
      } else {
        const { error } = await supabase
          .from('tags')
          .insert([formData]);

        if (error) throw error;
        setMessage('Tag added successfully');
      }

      setFormData({ name: '', color: '#3B82F6' });
      setShowForm(false);
      setEditingTag(null);
      fetchTags();
    } catch (error) {
      console.error('Error saving tag:', error);
      setMessage('Error saving tag');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (tag) => {
    setEditingTag(tag);
    setFormData({
      name: tag.name || '',
      color: tag.color || '#3B82F6'
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this tag? This will remove it from all customers.')) return;

    try {
      const { error } = await supabase
        .from('tags')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setMessage('Tag deleted successfully');
      fetchTags();
    } catch (error) {
      console.error('Error deleting tag:', error);
      setMessage('Error deleting tag');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingTag(null);
    setFormData({ name: '', color: '#3B82F6' });
  };

  const predefinedColors = [
    '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4',
    '#DC2626', '#059669', '#7C3AED', '#EA580C', '#BE185D',
    '#0891B2', '#059669', '#7C2D12', '#1E40AF', '#7C3AED'
  ];

  if (loading && tags.length === 0) {
    return (
      <div className="card">
        <h2>Loading tags...</h2>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Tags & Family Groups</h2>
        <button onClick={() => setShowForm(true)} className="btn btn-primary">
          Add Tag
        </button>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {showForm && (
        <div className="card">
          <h3>{editingTag ? 'Edit Tag' : 'Add New Tag'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="name">Tag Name *</label>
              <input
                type="text"
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Family A, VIP, Regular"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="color">Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <input
                  type="color"
                  id="color"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  style={{ width: '50px', height: '40px', border: 'none', borderRadius: '4px' }}
                />
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {predefinedColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setFormData({ ...formData, color })}
                      style={{
                        width: '30px',
                        height: '30px',
                        backgroundColor: color,
                        border: '2px solid #ddd',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        borderColor: formData.color === color ? '#333' : '#ddd'
                      }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div>
              <button type="submit" className="btn btn-success" disabled={loading}>
                {loading ? 'Saving...' : (editingTag ? 'Update' : 'Save')}
              </button>
              <button type="button" onClick={handleCancel} className="btn btn-secondary" style={{ marginLeft: '0.5rem' }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
          {tags.map((tag) => (
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
                    Created: {new Date(tag.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={() => handleEdit(tag)} className="btn btn-primary btn-sm">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(tag.id)} className="btn btn-danger btn-sm">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {tags.length === 0 && <p>No tags found. Create your first tag to get started!</p>}
      </div>
    </div>
  );
}

export default Tags;
