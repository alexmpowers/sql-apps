IF NOT EXISTS (SELECT 1 FROM dbo.DemoLimits WHERE id = 1)
    INSERT dbo.DemoLimits(id, global_window_start, global_mutation_count)
    VALUES (1, SYSUTCDATETIME(), 0);
GO
