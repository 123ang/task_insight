const express = require('express');
const { executeQuery } = require('../config/database');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Get all reminders for the current user
router.get('/', verifyToken, async(req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const whereConditions = ['r.user_id = ?'];
    const queryParams = [req.user.id];

    // Filter by status
    if (status) {
      whereConditions.push('r.status = ?');
      queryParams.push(status);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get reminders with file info
    const remindersQuery = `
      SELECT r.*, 
             f.name as file_name, 
             f.file_type, 
             f.file_size,
             f.folder_id,
             fo.name as folder_name
      FROM file_reminders r
      LEFT JOIN files f ON r.file_id = f.id
      LEFT JOIN folders fo ON f.folder_id = fo.id
      ${whereClause}
      ORDER BY r.reminder_datetime ASC
      LIMIT ${parseInt(limit, 10)} OFFSET ${offset}
    `;

    const remindersResult = await executeQuery(remindersQuery, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM file_reminders r
      ${whereClause}
    `;
    const countResult = await executeQuery(countQuery, queryParams);

    if (!remindersResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch reminders'
      });
    }

    res.json({
      success: true,
      data: {
        reminders: remindersResult.data || [],
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total: countResult.data?.[0]?.total || 0,
          pages: Math.ceil((countResult.data?.[0]?.total || 0) / parseInt(limit, 10))
        }
      }
    });
  } catch (error) {
    console.error('Get reminders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get pending/upcoming reminders (for notification bell)
router.get('/pending', verifyToken, async(req, res) => {
  try {
    // Get reminders that are due (past or within next 24 hours) and not yet notified
    const remindersQuery = `
      SELECT r.*, 
             f.name as file_name, 
             f.file_type, 
             f.file_size,
             f.folder_id,
             fo.name as folder_name
      FROM file_reminders r
      LEFT JOIN files f ON r.file_id = f.id
      LEFT JOIN folders fo ON f.folder_id = fo.id
      WHERE r.user_id = ? 
        AND r.status = 'pending'
        AND r.reminder_datetime <= DATE_ADD(NOW(), INTERVAL 24 HOUR)
      ORDER BY r.reminder_datetime ASC
      LIMIT 20
    `;

    const remindersResult = await executeQuery(remindersQuery, [req.user.id]);

    // Get count of all pending reminders (for badge)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM file_reminders
      WHERE user_id = ? AND status = 'pending' AND reminder_datetime <= NOW()
    `;
    const countResult = await executeQuery(countQuery, [req.user.id]);

    if (!remindersResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch pending reminders'
      });
    }

    res.json({
      success: true,
      data: {
        reminders: remindersResult.data || [],
        dueCount: countResult.data?.[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Get pending reminders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get to-do documents (files with pending reminders)
router.get('/todo-documents', verifyToken, async(req, res) => {
  try {
    const { page = 1, limit = 20, filter = 'all' } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let dateFilter = '';
    if (filter === 'overdue') {
      dateFilter = 'AND r.reminder_datetime < NOW()';
    } else if (filter === 'today') {
      dateFilter = 'AND DATE(r.reminder_datetime) = CURDATE()';
    } else if (filter === 'upcoming') {
      dateFilter = 'AND r.reminder_datetime > NOW() AND r.reminder_datetime <= DATE_ADD(NOW(), INTERVAL 7 DAY)';
    }

    // Get files with reminders
    const documentsQuery = `
      SELECT r.*, 
             f.id as file_id,
             f.name as file_name, 
             f.file_type, 
             f.file_size,
             f.folder_id,
             f.storage_path,
             fo.name as folder_name,
             u.first_name as created_by_first_name,
             u.last_name as created_by_last_name
      FROM file_reminders r
      INNER JOIN files f ON r.file_id = f.id AND f.status = 'active'
      LEFT JOIN folders fo ON f.folder_id = fo.id
      LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE r.user_id = ? 
        AND r.status IN ('pending', 'notified')
        ${dateFilter}
      ORDER BY 
        CASE 
          WHEN r.reminder_datetime < NOW() THEN 0 
          ELSE 1 
        END,
        r.reminder_datetime ASC
      LIMIT ${parseInt(limit, 10)} OFFSET ${offset}
    `;

    const documentsResult = await executeQuery(documentsQuery, [req.user.id]);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM file_reminders r
      INNER JOIN files f ON r.file_id = f.id AND f.status = 'active'
      WHERE r.user_id = ? 
        AND r.status IN ('pending', 'notified')
        ${dateFilter}
    `;
    const countResult = await executeQuery(countQuery, [req.user.id]);

    // Get summary counts
    const summaryQuery = `
      SELECT 
        SUM(CASE WHEN r.reminder_datetime < NOW() THEN 1 ELSE 0 END) as overdue_count,
        SUM(CASE WHEN DATE(r.reminder_datetime) = CURDATE() THEN 1 ELSE 0 END) as today_count,
        SUM(CASE WHEN r.reminder_datetime > NOW() AND r.reminder_datetime <= DATE_ADD(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as upcoming_count,
        COUNT(*) as total_count
      FROM file_reminders r
      INNER JOIN files f ON r.file_id = f.id AND f.status = 'active'
      WHERE r.user_id = ? AND r.status IN ('pending', 'notified')
    `;
    const summaryResult = await executeQuery(summaryQuery, [req.user.id]);

    if (!documentsResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch to-do documents'
      });
    }

    res.json({
      success: true,
      data: {
        documents: documentsResult.data || [],
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total: countResult.data?.[0]?.total || 0,
          pages: Math.ceil((countResult.data?.[0]?.total || 0) / parseInt(limit, 10))
        },
        summary: {
          overdue: summaryResult.data?.[0]?.overdue_count || 0,
          today: summaryResult.data?.[0]?.today_count || 0,
          upcoming: summaryResult.data?.[0]?.upcoming_count || 0,
          total: summaryResult.data?.[0]?.total_count || 0
        }
      }
    });
  } catch (error) {
    console.error('Get to-do documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Create a reminder for a file
router.post('/', verifyToken, async(req, res) => {
  try {
    const { fileId, reminderDatetime, title, note, priority, isRecurring, recurrencePattern, recurrenceEndDate } = req.body;

    if (!fileId || !reminderDatetime) {
      return res.status(400).json({
        success: false,
        message: 'File ID and reminder datetime are required'
      });
    }

    // Check if file exists and user has access
    const fileResult = await executeQuery(
      'SELECT id, organization_id FROM files WHERE id = ? AND status = "active"',
      [fileId]
    );

    if (!fileResult.success || fileResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const file = fileResult.data[0];

    // Check organization access
    if (req.user.role !== 'platform_owner' && file.organization_id !== req.user.organization_id) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to set a reminder for this file'
      });
    }

    // Create reminder
    const insertResult = await executeQuery(
      `INSERT INTO file_reminders 
       (file_id, user_id, organization_id, reminder_datetime, title, note, priority, is_recurring, recurrence_pattern, recurrence_end_date) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fileId,
        req.user.id,
        req.user.organization_id,
        reminderDatetime,
        title || null,
        note || null,
        priority || 'medium',
        isRecurring || false,
        recurrencePattern || null,
        recurrenceEndDate || null
      ]
    );

    if (!insertResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create reminder'
      });
    }

    // Log the action
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'CREATE', 'REMINDER', insertResult.data.insertId, JSON.stringify({ fileId, reminderDatetime })]
    );

    res.status(201).json({
      success: true,
      message: 'Reminder created successfully',
      data: {
        id: insertResult.data.insertId
      }
    });
  } catch (error) {
    console.error('Create reminder error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update a reminder
router.put('/:reminderId', verifyToken, async(req, res) => {
  try {
    const { reminderId } = req.params;
    const { reminderDatetime, title, note, priority, status, isRecurring, recurrencePattern, recurrenceEndDate } = req.body;

    // Check if reminder exists and belongs to user
    const reminderResult = await executeQuery(
      'SELECT id, user_id FROM file_reminders WHERE id = ?',
      [reminderId]
    );

    if (!reminderResult.success || reminderResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reminder not found'
      });
    }

    const reminder = reminderResult.data[0];

    // Check ownership
    if (reminder.user_id !== req.user.id && req.user.role !== 'platform_owner') {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this reminder'
      });
    }

    // Build update query
    const updateFields = [];
    const updateValues = [];

    if (reminderDatetime !== undefined) {
      updateFields.push('reminder_datetime = ?');
      updateValues.push(reminderDatetime);
    }
    if (title !== undefined) {
      updateFields.push('title = ?');
      updateValues.push(title);
    }
    if (note !== undefined) {
      updateFields.push('note = ?');
      updateValues.push(note);
    }
    if (priority !== undefined) {
      updateFields.push('priority = ?');
      updateValues.push(priority);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(status);

      // Set completed_at if marking as completed
      if (status === 'completed') {
        updateFields.push('completed_at = NOW()');
      }
    }
    if (isRecurring !== undefined) {
      updateFields.push('is_recurring = ?');
      updateValues.push(isRecurring);
    }
    if (recurrencePattern !== undefined) {
      updateFields.push('recurrence_pattern = ?');
      updateValues.push(recurrencePattern);
    }
    if (recurrenceEndDate !== undefined) {
      updateFields.push('recurrence_end_date = ?');
      updateValues.push(recurrenceEndDate);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateValues.push(reminderId);

    const updateResult = await executeQuery(
      `UPDATE file_reminders SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to update reminder'
      });
    }

    res.json({
      success: true,
      message: 'Reminder updated successfully'
    });
  } catch (error) {
    console.error('Update reminder error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Mark reminder as completed
router.post('/:reminderId/complete', verifyToken, async(req, res) => {
  try {
    const { reminderId } = req.params;

    // Check if reminder exists and belongs to user
    const reminderResult = await executeQuery(
      'SELECT id, user_id, is_recurring, recurrence_pattern, reminder_datetime, recurrence_end_date FROM file_reminders WHERE id = ?',
      [reminderId]
    );

    if (!reminderResult.success || reminderResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reminder not found'
      });
    }

    const reminder = reminderResult.data[0];

    // Check ownership
    if (reminder.user_id !== req.user.id && req.user.role !== 'platform_owner') {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to complete this reminder'
      });
    }

    // Mark as completed
    await executeQuery(
      'UPDATE file_reminders SET status = "completed", completed_at = NOW() WHERE id = ?',
      [reminderId]
    );

    // If recurring, create next occurrence
    if (reminder.is_recurring && reminder.recurrence_pattern) {
      const currentDate = new Date(reminder.reminder_datetime);
      let nextDate;

      switch (reminder.recurrence_pattern) {
      case 'daily':
        nextDate = new Date(currentDate.setDate(currentDate.getDate() + 1));
        break;
      case 'weekly':
        nextDate = new Date(currentDate.setDate(currentDate.getDate() + 7));
        break;
      case 'monthly':
        nextDate = new Date(currentDate.setMonth(currentDate.getMonth() + 1));
        break;
      case 'yearly':
        nextDate = new Date(currentDate.setFullYear(currentDate.getFullYear() + 1));
        break;
      default:
        nextDate = null; // unknown pattern: don't schedule a next occurrence
      }

      // Check if next date is before recurrence end date
      const endDate = reminder.recurrence_end_date ? new Date(reminder.recurrence_end_date) : null;
      if (nextDate && (!endDate || nextDate <= endDate)) {
        // Get original reminder details
        const originalResult = await executeQuery(
          'SELECT file_id, title, note, priority, is_recurring, recurrence_pattern, recurrence_end_date, organization_id FROM file_reminders WHERE id = ?',
          [reminderId]
        );

        if (originalResult.success && originalResult.data.length > 0) {
          const original = originalResult.data[0];
          await executeQuery(
            `INSERT INTO file_reminders 
             (file_id, user_id, organization_id, reminder_datetime, title, note, priority, is_recurring, recurrence_pattern, recurrence_end_date) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              original.file_id,
              req.user.id,
              original.organization_id,
              nextDate.toISOString().slice(0, 19).replace('T', ' '),
              original.title,
              original.note,
              original.priority,
              original.is_recurring,
              original.recurrence_pattern,
              original.recurrence_end_date
            ]
          );
        }
      }
    }

    res.json({
      success: true,
      message: 'Reminder marked as completed'
    });
  } catch (error) {
    console.error('Complete reminder error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Dismiss a reminder
router.post('/:reminderId/dismiss', verifyToken, async(req, res) => {
  try {
    const { reminderId } = req.params;

    // Check if reminder exists and belongs to user
    const reminderResult = await executeQuery(
      'SELECT id, user_id FROM file_reminders WHERE id = ?',
      [reminderId]
    );

    if (!reminderResult.success || reminderResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reminder not found'
      });
    }

    const reminder = reminderResult.data[0];

    // Check ownership
    if (reminder.user_id !== req.user.id && req.user.role !== 'platform_owner') {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to dismiss this reminder'
      });
    }

    // Mark as dismissed
    await executeQuery(
      'UPDATE file_reminders SET status = "dismissed" WHERE id = ?',
      [reminderId]
    );

    res.json({
      success: true,
      message: 'Reminder dismissed'
    });
  } catch (error) {
    console.error('Dismiss reminder error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete a reminder
router.delete('/:reminderId', verifyToken, async(req, res) => {
  try {
    const { reminderId } = req.params;

    // Check if reminder exists and belongs to user
    const reminderResult = await executeQuery(
      'SELECT id, user_id FROM file_reminders WHERE id = ?',
      [reminderId]
    );

    if (!reminderResult.success || reminderResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reminder not found'
      });
    }

    const reminder = reminderResult.data[0];

    // Check ownership
    if (reminder.user_id !== req.user.id && req.user.role !== 'platform_owner') {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this reminder'
      });
    }

    // Delete reminder
    await executeQuery('DELETE FROM file_reminders WHERE id = ?', [reminderId]);

    res.json({
      success: true,
      message: 'Reminder deleted successfully'
    });
  } catch (error) {
    console.error('Delete reminder error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get reminders for a specific file
router.get('/file/:fileId', verifyToken, async(req, res) => {
  try {
    const { fileId } = req.params;

    const remindersQuery = `
      SELECT r.*
      FROM file_reminders r
      WHERE r.file_id = ? AND r.user_id = ? AND r.status IN ('pending', 'notified')
      ORDER BY r.reminder_datetime ASC
    `;

    const remindersResult = await executeQuery(remindersQuery, [fileId, req.user.id]);

    if (!remindersResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch reminders'
      });
    }

    res.json({
      success: true,
      data: remindersResult.data || []
    });
  } catch (error) {
    console.error('Get file reminders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;

