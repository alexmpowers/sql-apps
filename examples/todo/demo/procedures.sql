CREATE PROCEDURE dbo.DemoCleanup
AS
BEGIN
    SET NOCOUNT ON;
    DELETE TOP (32) FROM dbo.DemoSessions WHERE expires_at <= SYSUTCDATETIME();
END;
GO
CREATE PROCEDURE dbo.DemoCreateSession @token_hash char(64)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF LEN(@token_hash) <> 64 OR @token_hash COLLATE Latin1_General_100_BIN2 LIKE '%[^0-9a-f]%'
        THROW 51001, 'Invalid server session hash.', 1;
    DECLARE @now datetime2(3) = SYSUTCDATETIME();
    DECLARE @expires datetime2(3);
    DECLARE @outcome nvarchar(32) = N'ok';
    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.DemoLimits WITH (UPDLOCK, HOLDLOCK) WHERE id = 1)
            THROW 51002, 'Demo limit row is missing.', 1;
        DELETE FROM dbo.DemoSessions WHERE expires_at <= SYSUTCDATETIME();
        SELECT @expires = expires_at FROM dbo.DemoSessions WITH (UPDLOCK, HOLDLOCK) WHERE token_hash = @token_hash;
        SET @now = SYSUTCDATETIME();
        IF @expires IS NOT NULL AND @expires <= @now
        BEGIN
            DELETE FROM dbo.DemoSessions WHERE token_hash = @token_hash;
            SET @expires = NULL;
        END;
        IF @expires IS NULL
        BEGIN
            IF (SELECT COUNT_BIG(*) FROM dbo.DemoSessions) >= 1000
                SET @outcome = N'capacity';
            ELSE
            BEGIN
                SET @expires = DATEADD(MINUTE, 60, @now);
                INSERT dbo.DemoSessions(token_hash, expires_at, window_start) VALUES (@token_hash, @expires, @now);
            END;
        END;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
    SELECT @outcome AS outcome, @expires AS expires_at;
END;
GO
CREATE PROCEDURE dbo.DemoGetSession @token_hash char(64)
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.DemoCleanup;
    DECLARE @expires datetime2(3);
    SELECT @expires = expires_at FROM dbo.DemoSessions WHERE token_hash = @token_hash AND expires_at > SYSUTCDATETIME();
    SELECT CAST(CASE WHEN @expires IS NULL THEN N'expired' ELSE N'ok' END AS nvarchar(32)) AS outcome, @expires AS expires_at;
END;
GO
CREATE PROCEDURE dbo.DemoDeleteSession @token_hash char(64)
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.DemoCleanup;
    DELETE FROM dbo.DemoSessions WHERE token_hash = @token_hash;
    SELECT CAST(N'expired' AS nvarchar(32)) AS outcome, CAST(NULL AS datetime2(3)) AS expires_at;
END;
GO
CREATE PROCEDURE dbo.DemoReadiness
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @count bigint;
    IF NOT EXISTS (SELECT 1 FROM dbo.DemoLimits WHERE id = 1)
        THROW 51002, 'Demo limit row is missing.', 1;
    SELECT TOP (1) @count = 1 FROM dbo.DemoSessions;
    SELECT TOP (1) @count = 1 FROM dbo.Todos;
    SELECT CAST(N'ready' AS nvarchar(32)) AS status, CAST(1 AS int) AS schema_version;
END;
GO
CREATE PROCEDURE dbo.DemoTodoList @token_hash char(64)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.DemoCleanup;
    DECLARE @outcome nvarchar(32) = N'expired';
    DECLARE @expires datetime2(3);
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @expires = expires_at FROM dbo.DemoSessions WITH (HOLDLOCK) WHERE token_hash = @token_hash;
        IF @expires > SYSUTCDATETIME() SET @outcome = N'ok';
        SELECT @outcome AS outcome, item.id, item.title, item.completed
        FROM (VALUES (1)) AS anchor(value)
        LEFT JOIN dbo.Todos AS item ON item.owner_session_hash = @token_hash AND @outcome = N'ok'
        ORDER BY item.created_at, item.id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO
CREATE PROCEDURE dbo.DemoTodoMutate
    @action nvarchar(10), @token_hash char(64), @id uniqueidentifier = NULL,
    @title nvarchar(max) = NULL, @completed bit = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @action NOT IN (N'create', N'update', N'delete')
        THROW 51001, 'Unsupported mutation.', 1;
    IF @title IS NOT NULL SET @title = LTRIM(RTRIM(@title));
    IF (@action = N'create' AND @title IS NULL) OR
       (@title IS NOT NULL AND (LEN(@title) = 0 OR DATALENGTH(@title) > 400)) OR
       (@action IN (N'update', N'delete') AND @id IS NULL) OR
       (@action = N'update' AND @title IS NULL AND @completed IS NULL)
        THROW 51001, 'Invalid mutation fields.', 1;
    DECLARE @now datetime2(3) = SYSUTCDATETIME();
    DECLARE @expires datetime2(3), @window datetime2(3), @count smallint;
    DECLARE @global_window datetime2(3), @global_count smallint;
    DECLARE @outcome nvarchar(32) = N'expired';
    DECLARE @result_id uniqueidentifier, @result_title nvarchar(200), @result_completed bit;
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @global_window = global_window_start, @global_count = global_mutation_count
        FROM dbo.DemoLimits WITH (UPDLOCK, HOLDLOCK) WHERE id = 1;
        IF @global_window IS NULL THROW 51002, 'Demo limit row is missing.', 1;
        IF @now >= DATEADD(SECOND, 60, @global_window)
        BEGIN
            SET @global_window = @now;
            SET @global_count = 0;
            UPDATE dbo.DemoLimits
            SET global_window_start = @now, global_mutation_count = 0
            WHERE id = 1;
        END;
        SELECT @expires = expires_at, @window = window_start, @count = mutation_count
        FROM dbo.DemoSessions WITH (UPDLOCK, HOLDLOCK) WHERE token_hash = @token_hash;
        SET @now = SYSUTCDATETIME();
        IF @expires > @now
        BEGIN
            IF @now >= DATEADD(SECOND, 60, @window)
            BEGIN
                SET @count = 0;
                UPDATE dbo.DemoSessions SET window_start = @now, mutation_count = 0 WHERE token_hash = @token_hash;
            END;
            IF @global_count >= 300
                SET @outcome = N'rate_limited';
            ELSE IF @count >= 30 SET @outcome = N'rate_limited';
            ELSE
            BEGIN
                UPDATE dbo.DemoLimits SET global_mutation_count = global_mutation_count + 1 WHERE id = 1;
                UPDATE dbo.DemoSessions SET mutation_count = mutation_count + 1 WHERE token_hash = @token_hash;
                IF @action = N'create'
                BEGIN
                    IF (SELECT COUNT_BIG(*) FROM dbo.Todos WHERE owner_session_hash = @token_hash) >= 50
                        SET @outcome = N'quota';
                    ELSE
                    BEGIN
                        SET @result_id = NEWID();
                        SET @result_title = @title;
                        SET @result_completed = 0;
                        INSERT dbo.Todos(id, owner_session_hash, title) VALUES (@result_id, @token_hash, @title);
                        SET @outcome = N'ok';
                    END;
                END;
                ELSE IF NOT EXISTS (SELECT 1 FROM dbo.Todos WHERE id = @id AND owner_session_hash = @token_hash)
                    SET @outcome = N'not_found';
                ELSE
                BEGIN
                    IF @action = N'update'
                        UPDATE dbo.Todos SET title = COALESCE(@title, title), completed = COALESCE(@completed, completed)
                        WHERE id = @id AND owner_session_hash = @token_hash;
                    SELECT @result_id = id, @result_title = title, @result_completed = completed
                    FROM dbo.Todos WHERE id = @id AND owner_session_hash = @token_hash;
                    IF @action = N'delete'
                        DELETE FROM dbo.Todos WHERE id = @id AND owner_session_hash = @token_hash;
                    SET @outcome = N'ok';
                END;
            END;
        END;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
    SELECT @outcome AS outcome, @result_id AS id, @result_title AS title, @result_completed AS completed;
END;
GO
CREATE PROCEDURE dbo.DemoTodoCreate @token_hash char(64), @title nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.DemoTodoMutate @action = N'create', @token_hash = @token_hash, @title = @title;
END;
GO
CREATE PROCEDURE dbo.DemoTodoUpdate @token_hash char(64), @id uniqueidentifier, @title nvarchar(max) = NULL, @completed bit = NULL
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.DemoTodoMutate @action = N'update', @token_hash = @token_hash, @id = @id, @title = @title, @completed = @completed;
END;
GO
CREATE PROCEDURE dbo.DemoTodoDelete @token_hash char(64), @id uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.DemoTodoMutate @action = N'delete', @token_hash = @token_hash, @id = @id;
END;
