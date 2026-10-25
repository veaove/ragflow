//
//  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//

package admin

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"ragflow/internal/agent/sandbox"
	"ragflow/internal/common"
	"ragflow/internal/dao"
	"ragflow/internal/engine"
	"ragflow/internal/engine/clickhouse"
	"ragflow/internal/engine/elasticsearch"
	"ragflow/internal/engine/kvrocks"
	"ragflow/internal/entity"
	modelModule "ragflow/internal/entity/models"
	"ragflow/internal/server"
	servicepkg "ragflow/internal/service"
	"ragflow/internal/storage"
	"regexp"
	"strings"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Service admin service layer
type Service struct {
	userDAO             *dao.UserDAO
	licenseDAO          *dao.LicenseDAO
	timeRecordDAO       *dao.TimeRecordDAO
	systemSettingsDAO   *dao.SystemSettingsDAO
	tenantDAO           *dao.TenantDAO
	userTenantDAO       *dao.UserTenantDAO
	fileDAO             *dao.FileDAO
	documentDAO         *dao.DocumentDAO
	taskDAO             *dao.TaskDAO
	kbDAO               *dao.KnowledgebaseDAO
	canvasDAO           *dao.UserCanvasDAO
	chatDAO             *dao.ChatDAO
	chatSessionDAO      *dao.ChatSessionDAO
	apiTokenDAO         *dao.APITokenDAO
	api4ConvDAO         *dao.API4ConversationDAO
	llmDAO              *dao.LLMDAO
	ingestionTaskDAO    *dao.IngestionTaskDAO
	ingestionTaskLogDao *dao.IngestionTaskLogDAO
	ingestionTaskSvc    *servicepkg.IngestionTaskService

	BillingProductDAO      *dao.BillingProductDAO
	BillingSubscriptionDAO *dao.BillingSubscriptionDAO
	MemoryDAO              *dao.MemoryDAO
	SearchDAO              *dao.SearchDAO
	deleteEngine           engine.DocEngine
	deleteStorage          storage.Storage
}

// NewService create admin service
func NewService() *Service {
	return &Service{
		userDAO:             dao.NewUserDAO(),
		licenseDAO:          dao.NewLicenseDAO(),
		timeRecordDAO:       dao.NewTimeRecordDAO(),
		systemSettingsDAO:   dao.NewSystemSettingsDAO(),
		tenantDAO:           dao.NewTenantDAO(),
		userTenantDAO:       dao.NewUserTenantDAO(),
		fileDAO:             dao.NewFileDAO(),
		documentDAO:         dao.NewDocumentDAO(),
		taskDAO:             dao.NewTaskDAO(),
		kbDAO:               dao.NewKnowledgebaseDAO(),
		canvasDAO:           dao.NewUserCanvasDAO(),
		chatDAO:             dao.NewChatDAO(),
		chatSessionDAO:      dao.NewChatSessionDAO(),
		apiTokenDAO:         dao.NewAPITokenDAO(),
		api4ConvDAO:         dao.NewAPI4ConversationDAO(),
		llmDAO:              dao.NewLLMDAO(),
		ingestionTaskDAO:    dao.NewIngestionTaskDAO(),
		ingestionTaskLogDao: dao.NewIngestionTaskLogDAO(),
		ingestionTaskSvc:    servicepkg.NewIngestionTaskService(),

		BillingProductDAO:      dao.NewBillingProductDAO(),
		BillingSubscriptionDAO: dao.NewBillingSubscriptionDAO(),
		MemoryDAO:              dao.NewMemoryDAO(),
		SearchDAO:              dao.NewSearchDAO(),
	}
}

// Logout user logout
func (s *Service) Logout(ctx context.Context, user interface{}) error {
	// Invalidate token by setting it to INVALID_ prefix
	if u, ok := user.(*entity.User); ok {
		invalidToken := "INVALID_" + generateRandomHex(16)
		return s.userDAO.UpdateAccessToken(ctx, dao.DB, u, invalidToken)
	}
	return nil
}

// ListIngestionTasks list all ingestion tasks for admin user
func (s *Service) ListIngestionTasks(ctx context.Context) ([]map[string]interface{}, error) {
	return s.ingestionTaskSvc.ListAllForAdmin(ctx)
}

func (s *Service) RemoveIngestionTasks(ctx context.Context, tasks []string) ([]map[string]string, error) {
	return s.ingestionTaskSvc.RemoveMany(ctx, tasks, nil)
}

func (s *Service) StopIngestionTasks(ctx context.Context, tasks []string) ([]*entity.IngestionTask, error) {
	return s.ingestionTaskSvc.RequestStopMany(ctx, tasks, nil)
}

// GetUserByToken get user by access token
func (s *Service) GetUserByToken(ctx context.Context, token string) (*entity.User, error) {
	user, err := s.userDAO.GetByAccessToken(ctx, dao.DB, token)
	if err != nil {
		return nil, common.ErrInvalidToken
	}

	if user.IsSuperuser == nil || !*user.IsSuperuser {
		return nil, common.ErrNotAdmin
	}

	if user.IsActive != "1" {
		return nil, fmt.Errorf("user inactive")
	}

	return user, nil
}

// generateRandomHex generate random hex string
func generateRandomHex(n int) string {
	bytes := make([]byte, n)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// ListUsers list all users
func (s *Service) ListUsers(ctx context.Context, pageIndex, pageSize int, name, status, sort, orderBy string) ([]map[string]interface{}, error) {
	users, _, err := s.userDAO.List(ctx, dao.DB, (pageIndex-1)*pageSize, pageSize, name, status, sort, orderBy)
	if err != nil {
		return nil, err
	}

	// 补充「所在租户」。
	// 一个用户理论上可属于多个租户，列表只展示一个，取 MIN 保证不因多行报错；
	// 用户与租户解耦后（创建用户不再自动建租户），未分配租户的用户这里是空串。
	type userTenantRow struct {
		UserID     string
		TenantName string
	}
	var utRows []userTenantRow
	if err := dao.DB.WithContext(ctx).Raw(`
		SELECT ut.user_id, MIN(IFNULL(t.name, '')) AS tenant_name
		FROM user_tenant ut
		JOIN tenant t ON t.id = ut.tenant_id
		WHERE ut.status = '1'
		GROUP BY ut.user_id
	`).Scan(&utRows).Error; err != nil {
		return nil, err
	}
	tenantByUser := make(map[string]string, len(utRows))
	for _, row := range utRows {
		tenantByUser[row.UserID] = row.TenantName
	}

	result := make([]map[string]interface{}, 0, len(users))
	for _, user := range users {
		result = append(result, map[string]interface{}{
			"email":        user.Email,
			"nickname":     user.Nickname,
			"create_date":  user.CreateTime,
			"is_active":    user.IsActive,
			"is_superuser": user.IsSuperuser,
			"tenant_name":  tenantByUser[user.ID],
		})
	}
	return result, nil
}

// CreateUser create a new user
// Parameters:
//   - username: email address of the user
//   - password: encrypted password (base64 encoded RSA encrypted)
//   - role: user role ("user" or "admin")
//
// Returns:
//   - map[string]interface{}: user information without password
//   - error: error message
func (s *Service) CreateUser(ctx context.Context, username, password, role, tenantID string) (map[string]interface{}, error) {
	emailRegex := regexp.MustCompile(`^[\w\._-]+@([\w_-]+\.)+[\w-]{2,}$`)
	if !emailRegex.MatchString(username) {
		return nil, fmt.Errorf("invalid email address: %s", username)
	}

	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return nil, fmt.Errorf("tenant_id is required")
	}
	var tenant entity.Tenant
	if err := dao.DB.WithContext(ctx).Where("id = ?", tenantID).First(&tenant).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("tenant not found")
		}
		return nil, err
	}

	existUser, _ := s.userDAO.GetByEmail(ctx, dao.DB, username)
	if existUser != nil {
		return nil, fmt.Errorf("user '%s' already exists", username)
	}

	decryptedPassword, err := common.DecryptPassword(password)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt password: %w", err)
	}

	hashedPassword, err := common.GenerateWerkzeugPasswordHash(decryptedPassword)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	userID := common.GenerateToken()
	accessToken := common.GenerateToken()
	status := "1"
	loginChannel := "password"
	isSuperuser := role == "admin"

	user := &entity.User{
		ID:              userID,
		AccessToken:     &accessToken,
		Email:           username,
		Nickname:        "",
		Password:        &hashedPassword,
		Status:          &status,
		IsActive:        "1",
		IsAuthenticated: "1",
		IsAnonymous:     "0",
		LoginChannel:    &loginChannel,
		IsSuperuser:     &isSuperuser,
	}

	// Start transaction for creating user and related data
	tx := dao.DB.Begin()
	if tx.Error != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", tx.Error)
	}

	// Rollback helper function
	rollbackTx := func() {
		if rbErr := tx.Rollback(); rbErr.Error != nil {
			common.Error("failed to rollback transaction", rbErr.Error)
		}
	}

	// 1. Create user
	if err = tx.Create(user).Error; err != nil {
		rollbackTx()
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// 绑定到调用方选定的租户，角色固定为普通成员（超管通过「设置超管」单独指定）。
	memberStatus := "1"
	member := &entity.UserTenant{
		ID:        common.GenerateUUID(),
		UserID:    userID,
		TenantID:  tenantID,
		Role:      "member",
		InvitedBy: userID,
		Status:    &memberStatus,
		JoinType:  "direct",
	}
	if err = tx.Create(member).Error; err != nil {
		rollbackTx()
		return nil, fmt.Errorf("failed to bind user to tenant: %w", err)
	}

	// Commit transaction
	if err = tx.Commit().Error; err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	common.Info("Create user success (no tenant created)", zap.String("username", username))

	return map[string]interface{}{
		"id":           user.ID,
		"email":        user.Email,
		"nickname":     user.Nickname,
		"is_active":    user.IsActive,
		"is_superuser": isSuperuser,
		"create_date":  user.CreateDate,
	}, nil
}

// GetUserDetails get user details
func (s *Service) GetUserDetails(ctx context.Context, username string) (map[string]interface{}, error) {
	user, err := s.userDAO.GetByEmail(ctx, dao.DB, username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, common.ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return map[string]interface{}{
		"avatar":          user.Avatar,
		"email":           user.Email,
		"language":        user.Language,
		"last_login_time": user.LastLoginTime,
		"is_active":       user.IsActive,
		"is_anonymous":    user.IsAnonymous,
		"login_channel":   user.LoginChannel,
		"status":          user.Status,
		"is_superuser":    user.IsSuperuser,
		"create_date":     user.CreateDate,
		"update_date":     user.UpdateDate,
	}, nil
}

// DeleteUserResult result of delete user operation
type DeleteUserResult struct {
	Username        string   `json:"username"`
	LangfuseCount   int      `json:"langfuse_count"`
	MetadataTable   string   `json:"metadata_table"`
	TenantCount     int      `json:"tenant_count"`
	UserTenantCount int      `json:"user_tenant_count"`
	UserCount       int      `json:"user_count"`
	DeletedDetails  []string `json:"deleted_details"`
}

// DeleteUser delete user with cascade delete of all related data
// Parameters:
//   - username: email address of the user to delete
//
// Returns:
//   - *DeleteUserResult
//   - error: error message
func (s *Service) DeleteUser(ctx context.Context, username string) (*DeleteUserResult, error) {
	userList, err := s.userDAO.ListByEmail(ctx, dao.DB, username)
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	if len(userList) == 0 {
		return nil, fmt.Errorf("user '%s' not found", username)
	}

	if len(userList) > 1 {
		return nil, fmt.Errorf("exist more than 1 user: %s", username)
	}

	user := userList[0]

	// Check if user is active - cannot delete active users
	if user.IsActive == "1" {
		return nil, fmt.Errorf("user '%s' is active and can't be deleted. Please deactivate the user first", username)
	}

	// Check if user is superuser - cannot delete admin accounts
	if user.IsSuperuser != nil && *user.IsSuperuser {
		return nil, fmt.Errorf("user '%s' is admin account and cannot be deleted", username)
	}

	return s.deleteUserData(ctx, user)
}

// ChangePassword change user password
// Parameters:
//   - username: email address of the user
//   - newPassword: new encrypted password (base64 encoded RSA encrypted)
//
// Returns:
//   - error: error message
func (s *Service) ChangePassword(ctx context.Context, username, newPassword string) error {
	userList, err := s.userDAO.ListByEmail(ctx, dao.DB, username)
	if err != nil || len(userList) == 0 {
		return fmt.Errorf("user '%s' not found", username)
	}

	if len(userList) > 1 {
		return fmt.Errorf("exist more than 1 user: %s", username)
	}

	user := userList[0]

	decryptedPassword, err := common.DecryptPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to decrypt password: %w", err)
	}

	if user.Password != nil && common.CheckWerkzeugPassword(decryptedPassword, *user.Password) {
		return nil
	}

	hashedPassword, err := common.GenerateWerkzeugPasswordHash(decryptedPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	user.Password = &hashedPassword

	if err = s.userDAO.Update(ctx, dao.DB, user); err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}

	return nil
}

// UpdateUserActivateStatus update user activate status
// Parameters:
//   - username: email address of the user
//   - isActive: true to activate, false to deactivate
//
// Returns:
//   - error: error message
func (s *Service) UpdateUserActivateStatus(ctx context.Context, username string, isActive bool) error {
	userList, err := s.userDAO.ListByEmail(ctx, dao.DB, username)
	if err != nil || len(userList) == 0 {
		return fmt.Errorf("user '%s' not found", username)
	}

	if len(userList) > 1 {
		return fmt.Errorf("exist more than 1 user: %s", username)
	}

	user := userList[0]

	targetStatus := "0"
	if isActive {
		targetStatus = "1"
	}

	if user.IsActive == targetStatus {
		return nil
	}

	user.IsActive = targetStatus
	if !isActive {
		invalidToken := "INVALID_" + common.GenerateToken()
		user.AccessToken = &invalidToken
	}

	if err = s.userDAO.Update(ctx, dao.DB, user); err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}

	return nil
}

// GrantAdmin grant admin privileges
// Parameters:
//   - username: email address of the user
//
// Returns:
//   - error: error message
func (s *Service) GrantAdmin(ctx context.Context, username string) error {
	userList, err := s.userDAO.ListByEmail(ctx, dao.DB, username)
	if err != nil || len(userList) == 0 {
		return fmt.Errorf("user '%s' not found", username)
	}

	if len(userList) > 1 {
		return fmt.Errorf("exist more than 1 user: %s", username)
	}

	user := userList[0]

	if user.IsSuperuser != nil && *user.IsSuperuser {
		return nil
	}

	isSuperuser := true
	user.IsSuperuser = &isSuperuser

	if err = s.userDAO.Update(ctx, dao.DB, user); err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}

	return nil
}

// RevokeAdmin revoke admin privileges
// Parameters:
//   - username: email address of the user
//
// Returns:
//   - error: error message
func (s *Service) RevokeAdmin(ctx context.Context, username string) error {
	userList, err := s.userDAO.ListByEmail(ctx, dao.DB, username)
	if err != nil || len(userList) == 0 {
		return fmt.Errorf("user '%s' not found", username)
	}

	if len(userList) > 1 {
		return fmt.Errorf("exist more than 1 user: %s", username)
	}

	user := userList[0]

	if user.IsSuperuser == nil || !*user.IsSuperuser {
		return nil
	}

	isSuperuser := false
	user.IsSuperuser = &isSuperuser

	if err = s.userDAO.Update(ctx, dao.DB, user); err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}

	return nil
}

// API Key methods

// ListUserAPITokens get user API keys
func (s *Service) ListUserAPITokens(ctx context.Context, username string) ([]map[string]interface{}, error) {
	// 1. Get user details
	user, err := s.userDAO.GetByEmail(ctx, dao.DB, username)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	// 2. Get user's tenants
	userTenants, err := s.userTenantDAO.GetByUserID(ctx, dao.DB, user.ID)
	if err != nil || len(userTenants) == 0 {
		return nil, fmt.Errorf("tenant not found")
	}

	tenantID := userTenants[0].TenantID

	// 3. Get API tokens by tenant ID
	tokens, err := s.apiTokenDAO.GetByTenantID(ctx, dao.DB, tenantID)
	if err != nil {
		return nil, fmt.Errorf("failed to get API tokens: %w", err)
	}

	// 4. Convert to map slice
	result := make([]map[string]interface{}, 0, len(tokens))
	for _, token := range tokens {
		result = append(result, map[string]interface{}{
			"tenant_id":   token.TenantID,
			"token":       token.Token,
			"beta":        token.Beta,
			"dialog_id":   token.DialogID,
			"source":      token.Source,
			"create_time": token.CreateTime,
			"create_date": token.CreateDate,
			"update_time": token.UpdateTime,
			"update_date": token.UpdateDate,
		})
	}

	return result, nil
}

// GenerateUserAPIToken generate API key for user
func (s *Service) GenerateUserAPIToken(ctx context.Context, username string) (map[string]interface{}, error) {
	// 1. Get user details
	user, err := s.userDAO.GetByEmail(ctx, dao.DB, username)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	// 2. Get user's tenants
	userTenants, err := s.userTenantDAO.GetByUserID(ctx, dao.DB, user.ID)
	if err != nil || len(userTenants) == 0 {
		return nil, fmt.Errorf("tenant not found")
	}

	tenantID := userTenants[0].TenantID

	// 3. Generate API token
	key := common.GenerateAPIToken()
	beta := common.GenerateBetaAPIToken()

	apiToken := &entity.APIToken{
		TenantID: tenantID,
		Token:    key,
		Beta:     &beta,
	}

	// 4. Save API token
	if err = s.apiTokenDAO.Create(ctx, dao.DB, apiToken); err != nil {
		return nil, fmt.Errorf("failed to generate API key: %w", err)
	}

	return map[string]interface{}{
		"tenant_id":   tenantID,
		"token":       key,
		"beta":        beta,
		"create_time": apiToken.CreateTime,
		"create_date": apiToken.CreateDate,
		"update_time": apiToken.UpdateTime,
		"update_date": apiToken.UpdateDate,
	}, nil
}

// DeleteUserAPIToken delete user API key
func (s *Service) DeleteUserAPIToken(ctx context.Context, username, key string) error {
	// 1. Get user details
	user, err := s.userDAO.GetByEmail(ctx, dao.DB, username)
	if err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	// 2. Get user's tenants
	userTenants, err := s.userTenantDAO.GetByUserID(ctx, dao.DB, user.ID)
	if err != nil || len(userTenants) == 0 {
		return fmt.Errorf("tenant not found")
	}

	tenantID := userTenants[0].TenantID

	// 3. Delete API token
	rowsAffected, err := s.apiTokenDAO.DeleteByTenantIDAndToken(ctx, dao.DB, tenantID, key)
	if err != nil {
		return fmt.Errorf("failed to delete API key: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("API key not found or could not be deleted")
	}

	return nil
}

type ServiceStatus struct {
	Type    string `json:"type"`
	Name    string `json:"name"`
	Host    string `json:"host"`
	Port    int    `json:"port"`
	Status  string `json:"status"`
	Elapsed string `json:"elapsed"`
	Message string `json:"message"`
}

func newServiceStatus(typeStr, nameStr, host string, port int, statusStr string, startTime time.Time, messageStr string) ServiceStatus {
	return ServiceStatus{
		Type:    typeStr,
		Name:    nameStr,
		Host:    host,
		Port:    port,
		Status:  statusStr,
		Elapsed: fmt.Sprintf("%.1d", time.Since(startTime).Milliseconds()),
		Message: messageStr,
	}
}

func serviceEndpoint(raw string, defaultPort int) (string, int) {
	if parsed, err := url.Parse(raw); err == nil && parsed.Hostname() != "" {
		raw = parsed.Host
	}
	host, port, err := net.SplitHostPort(raw)
	if err == nil {
		var portNumber int
		fmt.Sscanf(port, "%d", &portNumber)
		return host, portNumber
	}
	return raw, defaultPort
}

// ListServices get all services
func (s *Service) ListServices(ctx context.Context) ([]ServiceStatus, error) {

	var results []ServiceStatus

	globalConfig := server.GetConfig()
	// Database
	databaseType := globalConfig.DatabaseType()
	switch databaseType {
	case "mysql":
		mysqlStatus := s.getMySQLStatus(ctx)
		results = append(results, mysqlStatus)
	default:
		mysqlConfig := globalConfig.GetMySQLConfig()
		results = append(results, newServiceStatus("database", databaseType, mysqlConfig.Host, mysqlConfig.Port, "not available", time.Now(), "not supported database type"))
	}

	// Doc engine
	docEngineImpl := engine.Get()
	docHost, docPort := "-", 0
	if docEngineImpl.GetType() == "infinity" {
		docHost, docPort = serviceEndpoint(globalConfig.GetInfinityConfig().URI, 0)
	} else if docEngineImpl.GetType() == "elasticsearch" {
		docHost, docPort = serviceEndpoint(globalConfig.GetElasticsearchConfig().Hosts, 0)
	}
	err := docEngineImpl.Ping(ctx)
	if err == nil {
		results = append(results, newServiceStatus("doc_engine", docEngineImpl.GetType(), docHost, docPort, "alive", time.Now(), ""))
	} else {
		results = append(results, newServiceStatus("doc_engine", docEngineImpl.GetType(), docHost, docPort, "timeout", time.Now(), err.Error()))
	}

	// storage engine
	storageImpl := storage.GetStorageFactory().GetStorage()
	storageHost, storagePort := "-", 0
	if storageImpl.Type() == "minio" {
		storageHost, storagePort = serviceEndpoint(globalConfig.GetMinioConfig().Host, 0)
	}
	storageHealth := storageImpl.Health(ctx)
	if storageHealth {
		results = append(results, newServiceStatus("storage_engine", storageImpl.Type(), storageHost, storagePort, "alive", time.Now(), ""))
	} else {
		results = append(results, newServiceStatus("storage_engine", storageImpl.Type(), storageHost, storagePort, "timeout", time.Now(), ""))
	}

	// cache engine
	cacheType := globalConfig.CacheEngineType()
	switch cacheType {
	// The Go stack talks to Kvrocks. "redis" is accepted for backwards
	// compatibility with the shared service_conf.yaml.template; both map to
	// the same Kvrocks backend, so probe the same connection.
	case "redis", "kvrocks":
		kvrocksStatus := s.getKvrocksStatus(ctx)
		results = append(results, kvrocksStatus)
	default:
		redisConfig := globalConfig.GetKvrocksConfig()
		results = append(results, newServiceStatus("cache", cacheType, redisConfig.Host, redisConfig.Port, "not available", time.Now(), "not supported cache type"))
	}

	// message queue
	messageQueueImpl := engine.GetMessageQueueEngine()
	messageQueueStatus := messageQueueImpl.CheckStatus()
	if messageQueueStatus == "CONNECTED" {
		messageQueueStatus = "alive"
	}
	natsConfig := globalConfig.GetNATSConfig()
	results = append(results, newServiceStatus("message_queue", messageQueueImpl.Type(), natsConfig.Host, natsConfig.Port, messageQueueStatus, time.Now(), ""))

	results = append(results, s.GetEEServicesStatus(ctx)...)

	serverList := GlobalServerStore.ListInfos()
	for _, serverStatus := range serverList {
		now := time.Now()
		serverItem := newServiceStatus(string(serverStatus.ServerType), serverStatus.ServerName, serverStatus.Host, serverStatus.Port, "", serverStatus.Timestamp, "")
		// the difference between now and serverStatus.Timestamp is less than 5 seconds, then the server is alive
		if now.Sub(serverStatus.Timestamp) < 45*time.Second {
			serverItem.Status = "alive"
		} else {
			serverItem.Status = "timeout"
		}
		results = append(results, serverItem)
	}

	return results, nil
}

// GetServicesByType get services by type
func (s *Service) GetServicesByType(serviceType string) ([]map[string]interface{}, error) {
	return nil, errors.New("get_services_by_type: not implemented")
}

// GetServiceDetails get service details
func (s *Service) GetServiceDetails(configDict map[string]interface{}) ([]ServiceStatus, error) {
	//serviceType, _ := configDict["service_type"].(string)
	//name, _ := configDict["name"].(string)
	//ctx := context.Background()
	//
	//// Call detail function based on service type
	//switch serviceType {
	//case "meta_data":
	//	return s.getMySQLStatus(ctx), nil
	//case "cache":
	//	return s.getKvrocksStatus(ctx), nil
	//case "message_queue":
	//	host := configDict["host"].(string)
	//	port := configDict["port"].(int)
	//	return s.checkNatsAlive(name, host, port)
	//case "retrieval":
	//	// Check the extra.retrieval_type to determine which retrieval service
	//	if extra, ok := configDict["extra"].(map[string]interface{}); ok {
	//		if retrievalType, ok := extra["retrieval_type"].(string); ok {
	//			if retrievalType == "infinity" {
	//				return s.getInfinityStatus(name)
	//			}
	//		}
	//	}
	//	return s.getESClusterStats(name)
	//case "ragflow_server":
	//	return s.checkRAGFlowServerAlive(name)
	//case "file_store":
	//	return s.checkMinioAlive(name)
	//case "olap":
	//	return s.checkOlapAlive(name)
	//case "tracing":
	//	return s.checkTracingAlive(name)
	//default:
	//	return nil, nil
	//}
	return nil, nil
}

// getMySQLStatus gets MySQL service status
func (s *Service) getMySQLStatus(ctx context.Context) ServiceStatus {

	serviceType := "database"
	name := "mysql"
	startTime := time.Now()

	sqlDB, err := dao.DB.DB()
	if err != nil {
		mysqlConfig := server.GetConfig().GetMySQLConfig()
		return newServiceStatus(serviceType, name, mysqlConfig.Host, mysqlConfig.Port, "not connected", startTime, err.Error())
	}

	// Execute SELECT 1 to check connectivity
	err = sqlDB.PingContext(ctx)
	if err != nil {
		mysqlConfig := server.GetConfig().GetMySQLConfig()
		return newServiceStatus(serviceType, name, mysqlConfig.Host, mysqlConfig.Port, "timeout", startTime, err.Error())
	}

	mysqlConfig := server.GetConfig().GetMySQLConfig()
	return newServiceStatus(serviceType, name, mysqlConfig.Host, mysqlConfig.Port, "alive", startTime, "")
}

// getKvrocksStatus gets the Kvrocks service status.
func (s *Service) getKvrocksStatus(ctx context.Context) ServiceStatus {

	serviceType := "cache"
	name := "kvrocks"

	startTime := time.Now()
	kvrocksConfig := server.GetConfig().GetKvrocksConfig()

	kvrocksClient := kvrocks.Get()
	if kvrocksClient.Health(ctx) {
		return newServiceStatus(serviceType, name, kvrocksConfig.Host, kvrocksConfig.Port, "alive", startTime, "")
	}

	return newServiceStatus(serviceType, name, kvrocksConfig.Host, kvrocksConfig.Port, "timeout", startTime, "Kvrocks health check failed")
}

// getESClusterStats gets Elasticsearch cluster stats
func (s *Service) getESClusterStats(ctx context.Context, serviceType string) map[string]interface{} {
	name := "elasticsearch"
	startTime := time.Now()

	cfg := server.GetConfig()
	if cfg == nil || !cfg.IsElasticConfigured() {
		return map[string]interface{}{
			"type":    serviceType,
			"name":    name,
			"status":  "timeout",
			"elapsed": fmt.Sprintf("%.1d", time.Since(startTime).Milliseconds()),
			"message": "error: Elasticsearch configuration not found",
		}
	}

	// Create ES engine and get cluster stats
	esEngine, err := elasticsearch.NewEngine(ctx, cfg.GetElasticsearchConfig())
	if err != nil {
		return map[string]interface{}{
			"type":    serviceType,
			"name":    name,
			"status":  "timeout",
			"elapsed": fmt.Sprintf("%.1d", time.Since(startTime).Milliseconds()),
			"message": fmt.Sprintf("error: %s", err.Error()),
		}
	}
	defer esEngine.Close()

	clusterStats, err := esEngine.GetClusterStats(ctx)
	if err != nil {
		return map[string]interface{}{
			"type":    serviceType,
			"name":    name,
			"status":  "timeout",
			"elapsed": fmt.Sprintf("%.1d", time.Since(startTime).Milliseconds()),
			"message": fmt.Sprintf("error: %s", err.Error()),
		}
	}

	return map[string]interface{}{
		"type":    serviceType,
		"name":    name,
		"status":  "alive",
		"elapsed": fmt.Sprintf("%.1d", time.Since(startTime).Milliseconds()),
		"message": clusterStats,
	}
}

// getInfinityStatus gets Infinity service status
func (s *Service) getInfinityStatus(serviceType string) map[string]interface{} {
	name := "infinity"
	startTime := time.Now()
	// TODO: Implement actual Infinity health check
	return map[string]interface{}{
		"type":    serviceType,
		"name":    name,
		"status":  "unknown",
		"elapsed": fmt.Sprintf("%.1d", time.Since(startTime).Milliseconds()),
		"message": "Infinity health check not implemented",
	}
}

// checkTaskExecutorAlive checks if task executor is alive
func (s *Service) checkTaskExecutorAlive(name string) (map[string]interface{}, error) {
	// TODO: Implement actual task executor health check
	return map[string]interface{}{
		"service_name": name,
		"status":       "unknown",
		"message":      "Task executor health check not implemented",
	}, nil
}

// checkNatsAlive checks if NATS is alive
func (s *Service) checkNatsAlive(name string, ip string, port int) (map[string]interface{}, error) {

	msgQueueEngine := engine.GetMessageQueueEngine()
	if msgQueueEngine == nil {
		return map[string]interface{}{
			"service_name": name,
			"status":       "Message queue engine not initialized",
		}, nil
	}

	status := msgQueueEngine.CheckStatus()

	return map[string]interface{}{
		"service_name": name,
		"status":       status,
	}, nil
}

// checkTracingAlive checks if tracing is alive
func (s *Service) checkTracingAlive(name string) (map[string]interface{}, error) {
	return map[string]interface{}{
		"service_name": name,
		"status":       "unknown",
		"message":      "Tracing health check not implemented",
	}, nil
}

// checkOlapAlive checks if ClickHouse is alive
func (s *Service) checkOlapAlive(name string) (map[string]interface{}, error) {
	clickhouseDriver := clickhouse.GetDriver()
	if clickhouseDriver == nil {
		return map[string]interface{}{
			"service_name": name,
			"status":       "unknown",
		}, nil
	}

	status, err := clickhouseDriver.Status()
	if err != nil {
		return map[string]interface{}{
			"service_name": name,
			"status":       "timeout",
			"message":      fmt.Sprintf("error: %s", err.Error()),
		}, nil
	}

	return map[string]interface{}{
		"service_name": name,
		"status":       "alive",
		"message":      status,
	}, nil
}

// ShutdownService shutdown service
func (s *Service) ShutdownService(serviceName string) (map[string]interface{}, error) {
	// TODO: Implement with proper service manager
	return map[string]interface{}{
		"command":      "shutdown service",
		"service_name": serviceName,
		"error":        "shutdown service not implemented",
	}, nil
}

// StartService start service
func (s *Service) StartService(serviceName string) (map[string]interface{}, error) {
	return map[string]interface{}{
		"command":      "start service",
		"service_name": serviceName,
		"error":        "command 'start service' isn't implemented",
	}, nil
}

// RestartService restart service
func (s *Service) RestartService(serviceName string) (map[string]interface{}, error) {
	return map[string]interface{}{
		"command":      "restart service",
		"service_name": serviceName,
		"error":        "command 'restart service' isn't implemented",
	}, nil
}

// AdminException admin exception error
type AdminException struct {
	Message string
	Code    int
}

// Error implement error interface
func (e *AdminException) Error() string {
	return e.Message
}

// NewAdminException create admin exception
func NewAdminException(message string) *AdminException {
	return &AdminException{
		Message: message,
		Code:    400,
	}
}

// GetVariable get variable by name
// Returns the exact system setting with the given name, or settings matching the
// given name prefix when an exact setting does not exist.
func (s *Service) GetVariable(ctx context.Context, varName string) ([]map[string]interface{}, error) {
	settings, err := s.systemSettingsDAO.GetByName(ctx, dao.DB, varName)
	if err != nil {
		return nil, err
	}

	if len(settings) == 0 {
		settings, err = s.systemSettingsDAO.GetByNamePrefix(ctx, dao.DB, varName)
		if err != nil {
			return nil, err
		}
		if len(settings) == 0 {
			return nil, NewAdminException("Can't get setting: " + varName)
		}
	}
	return entity.FormatSystemSettings(settings), nil
}

// ListAllVariables list all variables
// Returns all system settings from database
func (s *Service) ListAllVariables(ctx context.Context) ([]map[string]interface{}, error) {
	settings, err := s.systemSettingsDAO.GetAll(ctx, dao.DB)
	if err != nil {
		return nil, err
	}

	return entity.FormatSystemSettings(settings), nil
}

// SetVariable set variable
// Creates or updates a system setting
// If the setting exists, updates it; otherwise creates a new one
func (s *Service) SetVariable(ctx context.Context, varName, varValue string) error {
	return s.setVariable(ctx, dao.DB, varName, varValue)
}

func (s *Service) setVariable(ctx context.Context, db *gorm.DB, varName, varValue string) error {
	settings, err := s.systemSettingsDAO.GetByName(ctx, db, varName)
	if err != nil {
		return err
	}

	if len(settings) == 1 {
		setting := &settings[0]
		if err = entity.ValidateSystemSettingValue(*setting, varValue); err != nil {
			return err
		}
		setting.Value = varValue
		return s.systemSettingsDAO.UpdateByName(ctx, db, varName, setting)
	} else if len(settings) > 1 {
		return NewAdminException("Can't update more than 1 setting: " + varName)
	}

	dataType := entity.InferSystemSettingDataType(varName)
	newSetting := &entity.SystemSettings{
		Name:     varName,
		Value:    varValue,
		Source:   "admin",
		DataType: dataType,
	}
	if err = entity.ValidateSystemSettingValue(*newSetting, varValue); err != nil {
		return err
	}
	return s.systemSettingsDAO.Create(ctx, db, newSetting)
}

// Config methods

// ListAllConfigs list all configs
// Returns all service configurations from the config file
func (s *Service) ListAllConfigs() ([]map[string]interface{}, error) {
	result, err := server.GetAllConfigs()
	if err != nil {
		return nil, err
	}
	return result, nil
}

// Environment methods

// ListEnvironments list all environments
func (s *Service) ListEnvironments() ([]map[string]interface{}, error) {
	result := make([]map[string]interface{}, 0)

	globalConfig := server.GetConfig()

	// DOC_ENGINE
	docEngine := globalConfig.GetEnvDocumentEngineType()
	if docEngine == "" {
		docEngine = "elasticsearch"
	}
	result = append(result, map[string]interface{}{
		"env":   "DOCUMENT_ENGINE",
		"value": docEngine,
	})

	// DEFAULT_SUPERUSER_EMAIL
	defaultSuperuserEmail := globalConfig.GetEnvDefaultSuperUserEmail()
	if defaultSuperuserEmail == "" {
		defaultSuperuserEmail = "admin@ragflow.io"
	}
	result = append(result, map[string]interface{}{
		"env":   "DEFAULT_SUPERUSER_EMAIL",
		"value": defaultSuperuserEmail,
	})

	// DB_TYPE
	dbType := globalConfig.GetEnvDatabaseType()
	if dbType == "" {
		dbType = "mysql"
	}
	result = append(result, map[string]interface{}{
		"env":   "DATABASE",
		"value": dbType,
	})

	// DEVICE
	device := globalConfig.GetEnvDeviceType()
	if device == "" {
		device = "cpu"
	}
	result = append(result, map[string]interface{}{
		"env":   "DEVICE",
		"value": device,
	})

	// STORAGE_IMPL
	storageImpl := globalConfig.GetEnvStorageType()
	if storageImpl == "" {
		storageImpl = "minio"
	}
	result = append(result, map[string]interface{}{
		"env":   "STORAGE",
		"value": storageImpl,
	})

	return result, nil
}

// Version methods

// GetVersion get RAGFlow version
func (s *Service) GetVersion() (string, string) {
	return common.GetRAGFlowVersion(), common.GetRAGFlowType()
}

// Sandbox methods

// ListSandboxProviders list sandbox providers
func (s *Service) ListSandboxProviders() ([]map[string]interface{}, error) {
	return sandbox.ListProviders(), nil
}

// GetSandboxProviderSchema get sandbox provider schema
func (s *Service) GetSandboxProviderSchema(providerID string) (map[string]interface{}, error) {
	schema, err := sandbox.ConfigSchema(providerID)
	if err != nil {
		return nil, common.NewCodedError(common.CodeBadRequest, err.Error())
	}
	return schema, nil
}

// GetSandboxConfig get sandbox config
func (s *Service) GetSandboxConfig(ctx context.Context, providerType string) (map[string]interface{}, error) {
	settings, err := s.systemSettingsDAO.GetByNamePrefix(ctx, dao.DB, "sandbox.")
	if err != nil {
		return nil, err
	}

	values := make(map[string]string, len(settings))
	for _, setting := range settings {
		if _, exists := values[setting.Name]; exists {
			return nil, fmt.Errorf("duplicate sandbox setting: %s", setting.Name)
		}
		values[setting.Name] = setting.Value
	}
	if providerType == "" {
		providerType = "self_managed"
		if value, exists := values["sandbox.provider_type"]; exists {
			providerType = value
		}
	}
	schema, err := sandbox.ConfigSchema(providerType)
	if err != nil {
		return nil, common.NewCodedError(common.CodeBadRequest, err.Error())
	}

	raw := values["sandbox."+providerType]
	var config map[string]interface{}
	if raw != "" {
		var value interface{}
		if err := json.Unmarshal([]byte(raw), &value); err != nil {
			config = nil
		} else if value == nil {
			return nil, common.NewCodedError(common.CodeBadRequest,
				fmt.Sprintf("sandbox.%s must contain a JSON object", providerType))
		} else if object, ok := value.(map[string]interface{}); ok {
			config = object
		} else {
			return nil, common.NewCodedError(common.CodeBadRequest,
				fmt.Sprintf("sandbox.%s must contain a JSON object", providerType))
		}
	}
	if len(config) == 0 {
		config = make(map[string]interface{})
		for name, field := range schema {
			fieldSchema, ok := field.(map[string]any)
			if !ok {
				continue
			}
			if fieldSchema["readonly"] == true {
				continue
			}
			if value, ok := fieldSchema["default"]; ok && value != nil {
				config[name] = value
			}
		}
	}
	return map[string]interface{}{"provider_type": providerType, "config": config}, nil
}

// SetSandboxConfig set sandbox config
func (s *Service) SetSandboxConfig(ctx context.Context, providerType string, config map[string]interface{}, setActive bool) (map[string]interface{}, error) {
	if config == nil {
		return nil, common.NewCodedError(common.CodeBadRequest, "config must be a JSON object")
	}
	if err := sandbox.ValidateConfig(providerType, config); err != nil {
		return nil, common.NewCodedError(common.CodeBadRequest, err.Error())
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return nil, common.NewCodedError(common.CodeBadRequest, fmt.Sprintf("invalid sandbox configuration: %v", err))
	}
	err = s.systemSettingsDAO.Transaction(ctx, dao.DB, func(tx *gorm.DB) error {
		if setActive {
			if err := s.setVariable(ctx, tx, "sandbox.provider_type", providerType); err != nil {
				return err
			}
		}
		return s.setVariable(ctx, tx, "sandbox."+providerType, string(encoded))
	})
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"provider_type": providerType, "config": config}, nil
}

// TestSandboxConnection test sandbox connection
func (s *Service) TestSandboxConnection(ctx context.Context, providerType string, config map[string]interface{}) (map[string]interface{}, error) {
	result, err := sandbox.TestConnection(ctx, providerType, config)
	if err != nil {
		return nil, common.NewCodedError(common.CodeBadRequest, err.Error())
	}
	return result, nil
}

var heartBeatCount int64 = 0

// HandleHeartbeat handle heartbeat
func (s *Service) HandleHeartbeat(message *common.BaseMessage) (common.ErrorCode, map[string]interface{}, string) {
	heartBeatCount++

	status := &common.BaseMessage{
		ServerName: message.ServerName,
		ServerType: message.ServerType,
		Host:       message.Host,
		Port:       message.Port,
		Version:    message.Version,
		Timestamp:  message.Timestamp,
		Ext:        message.Ext,
	}
	return UpdateServer(message.ServerName, status)
}

// InitDefaultAdmin initialize default admin user
// This matches Python's init_default_admin behavior
func (s *Service) InitDefaultAdmin() error {
	// Default superuser settings (matching Python's DEFAULT_SUPERUSER_* defaults)
	defaultNickname := "admin"
	defaultEmail := "admin@ragflow.io"
	defaultPassword := "admin"

	// Query superusers
	var users []*entity.User
	err := dao.DB.Where("is_superuser = ? AND status = ?", true, "1").Find(&users).Error
	if err != nil {
		return fmt.Errorf("failed to query superusers: %w", err)
	}

	if len(users) == 0 {
		userID := common.GenerateToken()
		accessToken := common.GenerateToken()
		status := "1"
		loginChannel := "password"
		isSuperuser := true

		// Python: password = encode_to_base64(password) = base64.b64encode(password)
		// Then: generate_password_hash(base64_password) creates werkzeug hash
		password := base64.StdEncoding.EncodeToString([]byte(defaultPassword))
		hashedPassword, err := common.GenerateWerkzeugPasswordHash(password)
		if err != nil {
			return fmt.Errorf("failed to hash password: %w", err)
		}

		user := &entity.User{
			ID:              userID,
			Email:           defaultEmail,
			Nickname:        defaultNickname,
			Password:        &hashedPassword,
			AccessToken:     &accessToken,
			Status:          &status,
			IsActive:        "1",
			IsAuthenticated: "1",
			IsAnonymous:     "0",
			LoginChannel:    &loginChannel,
			IsSuperuser:     &isSuperuser,
		}

		if err = dao.DB.Create(user).Error; err != nil {
			return fmt.Errorf("can't init admin: %w", err)
		}

		if err = s.addTenantForAdmin(userID, defaultNickname); err != nil {
			return fmt.Errorf("failed to add tenant for admin: %w", err)
		}

		common.Info("Init default super user successfully")
		return nil
	}

	for _, user := range users {
		if user.IsActive != "1" {
			return fmt.Errorf("no active admin. Please update 'is_active' in db manually")
		}
	}

	for _, user := range users {
		if user.Email == defaultEmail {
			// Check if tenant exists
			var count int64
			dao.DB.Model(&entity.UserTenant{}).Where("user_id = ? AND status = ?", user.ID, "1").Count(&count)
			if count == 0 {
				nickname := defaultNickname
				if user.Nickname != "" {
					nickname = user.Nickname
				}
				if err = s.addTenantForAdmin(user.ID, nickname); err != nil {
					return err
				}
			}
			break
		}
	}

	common.Info("Init default super user successfully")
	return nil
}

// addTenantForAdmin add tenant for admin user
func (s *Service) addTenantForAdmin(userID, nickname string) error {
	status := "1"
	role := "owner"
	tenantName := nickname + "'s Kingdom"

	tenant := &entity.Tenant{
		ID:   userID,
		Name: &tenantName,
	}

	if err := dao.DB.Create(tenant).Error; err != nil {
		return err
	}

	userTenant := &entity.UserTenant{
		TenantID:  userID,
		UserID:    userID,
		InvitedBy: userID,
		Role:      role,
		Status:    &status,
	}

	return dao.DB.Create(userTenant).Error
}

// ListAllModels list all models
func (s *Service) ListAllModels(pageIndex, pageSize int) ([]map[string]interface{}, error) {
	models, err := dao.GetModelProviderManager().ListAllModels()
	if err != nil {
		return nil, err
	}
	if pageSize > 0 && pageIndex >= 0 && pageIndex*pageSize < len(models) {
		return models[pageIndex*pageSize : (pageIndex+1)*pageSize], nil
	}
	return models, nil
}

func (s *Service) GetModelByModelName(modelName string) (*modelModule.Model, error) {
	return dao.GetModelProviderManager().GetModelByNameOrAlias(modelName), nil
}

// TenantListItem is one row of the platform tenant list.
type TenantListItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	MemberCount int64  `json:"member_count"`
	KbCount     int64  `json:"kb_count"`
	AgentCount  int64  `json:"agent_count"`
	Status      string `json:"status"`
	CreateDate  int64  `json:"create_date"`
}

// ListTenants returns tenants with member / knowledge-base / agent counts.
//
// 计数口径：knowledgebase 只统计 status='1' 的有效库；user_tenant 只统计
// status='1' 的有效成员。
//
// user_canvas 没有 tenant_id 列：租户 id 就是 owner 的 user id（见
// dao/analytics.go 里同样拿 tenantID 去 join user_canvas.user_id 的写法），
// 所以智能体数按 c.user_id = t.id 统计。写成 c.tenant_id = t.id 会在 MySQL
// 上报 Error 1054，整个租户列表页直接 500。
func (s *Service) ListTenants(ctx context.Context, pageIndex, pageSize int, keyword, status string) ([]TenantListItem, int64, error) {
	base := dao.DB.WithContext(ctx).Table("tenant AS t")
	if keyword != "" {
		base = base.Where("t.name LIKE ?", "%"+keyword+"%")
	}
	if status != "" {
		base = base.Where("t.status = ?", status)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	rows := make([]TenantListItem, 0, pageSize)
	err := base.
		Select(`t.id,
			t.name,
			(SELECT COUNT(*) FROM user_tenant ut WHERE ut.tenant_id = t.id AND ut.status = '1') AS member_count,
			(SELECT COUNT(*) FROM knowledgebase k WHERE k.tenant_id = t.id AND k.status = '1') AS kb_count,
			(SELECT COUNT(*) FROM user_canvas c WHERE c.user_id = t.id) AS agent_count,
			t.status,
			IFNULL(t.create_time, 0) AS create_date`).
		Order("t.create_date DESC").
		Offset((pageIndex - 1) * pageSize).
		Limit(pageSize).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// CreateTenant creates a tenant owned by an existing user.
//
// 不自动创建用户：平台必须先有账号，再把它指定为这个租户的管理员。
func (s *Service) CreateTenant(ctx context.Context, name, ownerUserID, ownerEmail string) (map[string]interface{}, error) {
	name = strings.TrimSpace(name)
	ownerUserID = strings.TrimSpace(ownerUserID)
	ownerEmail = strings.TrimSpace(ownerEmail)
	if name == "" {
		return nil, fmt.Errorf("tenant name is required")
	}
	if len([]rune(name)) > 100 {
		return nil, fmt.Errorf("tenant name must be at most 100 characters")
	}
	if ownerUserID == "" && ownerEmail == "" {
		return nil, fmt.Errorf("owner user is required")
	}

	// 平台指定已有用户作为管理员：优先用 id，其次按邮箱查。
	var owner entity.User
	q := dao.DB.WithContext(ctx)
	if ownerUserID != "" {
		q = q.Where("id = ?", ownerUserID)
	} else {
		q = q.Where("email = ?", ownerEmail)
	}
	if err := q.First(&owner).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("owner user not found (email: %s)", ownerEmail)
		}
		return nil, err
	}
	ownerUserID = owner.ID

	// 模型配置沿用平台已有租户的默认值：tenant 表的 llm_id / embd_id 等
	// 都是 not null，新租户必须带上，否则后续检索和对话直接报错。
	var tmpl entity.Tenant
	if err := dao.DB.WithContext(ctx).Order("create_date ASC").First(&tmpl).Error; err != nil {
		return nil, fmt.Errorf("no tenant template available: %w", err)
	}

	status := "1"
	tenantID := common.GenerateUUID()
	tenant := &entity.Tenant{
		ID:        tenantID,
		Name:      &name,
		LLMID:     tmpl.LLMID,
		EmbdID:    tmpl.EmbdID,
		ASRID:     tmpl.ASRID,
		Img2TxtID: tmpl.Img2TxtID,
		RerankID:  tmpl.RerankID,
		ParserIDs: tmpl.ParserIDs,
		Credit:    512,
		Status:    &status,
	}

	err := dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(tenant).Error; err != nil {
			return err
		}
		member := &entity.UserTenant{
			ID:        common.GenerateUUID(),
			UserID:    ownerUserID,
			TenantID:  tenantID,
			Role:      "owner",
			InvitedBy: ownerUserID,
			Status:    &status,
		}
		return tx.Create(member).Error
	})
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"id":          tenantID,
		"name":        name,
		"owner_email": owner.Email,
	}, nil
}

// formatOptionalTime 用固定布局渲染可空时间；nil 返回空串，由前端补「—」。
func formatOptionalTime(t *time.Time, layout string) string {
	if t == nil {
		return ""
	}
	return t.Format(layout)
}

// canvasCategoryLabel 把 user_canvas.canvas_category 翻成中文类型名。
//
// 平台侧只关心「这条记录是什么」：agent_count 统计的是 user_canvas 全表，
// 所以明细里必须能区分智能体、对话流、工作流与数据处理画布。
func canvasCategoryLabel(category string) string {
	switch category {
	case entity.CanvasCategoryAgent:
		return "智能体"
	case entity.CanvasCategoryChatflow:
		return "对话流"
	case entity.CanvasCategoryWorkflow:
		return "工作流"
	case entity.CanvasCategoryDataflow:
		return "数据处理"
	default:
		return category
	}
}

// accountStatusLabel 归一化账号启用状态（user.status / user.is_active 都是
// varchar('1'/'0')）。任一处明确写了停用就算停用，避免把被禁用的账号
// 显示成「正常」——那会让人以为自己点错了。
func accountStatusLabel(status, isActive string) string {
	if status == "0" || isActive == "0" {
		return "disabled"
	}
	return "active"
}

// parserLabel 把 knowledgebase.parser_id 翻成中文名，取值与知识库配置页的
// knowledgeConfiguration.parserLabel 对齐，避免同一份配置在两处叫不同名字。
//
// naive 是 general 的历史别名（老数据里两种写法都有），统一显示成「通用」。
func parserLabel(parserID string) string {
	if parserID == "" {
		return ""
	}
	switch parserID {
	case "naive", "general":
		return "通用"
	case "qa":
		return "问答"
	case "resume":
		return "简历"
	case "manual":
		return "手动"
	case "table":
		return "表格"
	case "paper":
		return "论文"
	case "book":
		return "书籍"
	case "laws":
		return "法律"
	case "presentation":
		return "演示文稿"
	case "picture":
		return "图片"
	case "one":
		return "单文件"
	case "audio":
		return "音频"
	case "email":
		return "邮件"
	case "tag":
		return "标签"
	case "knowledge_graph":
		return "知识图谱"
	default:
		// 认不出来的 id 原样返回：显示 "graph_rag_v2" 也比显示「未知」有用。
		return parserID
	}
}

// datasetEnabledLabel 是知识库的业务开关。
//
// 注意 enabled 与 status 是两回事：status 是软删除标记（写 0 就从列表和
// 检索里消失），enabled 才是用户在界面上点的「启用/停用」。这里只读 enabled。
func datasetEnabledLabel(enabled int64) string {
	if enabled == 0 {
		return "disabled"
	}
	return "enabled"
}

// embeddingLabel 把 embd_id 还原成人能读的模型名。
//
// 新数据的 embd_id 存的是 tenant_model.id（32 位十六进制），需要先 JOIN 出
// model_name；老数据可能直接存 "BAAI/bge-large-zh-v1.5@BAAI"，取 @ 前那段。
// 两种都拿不到时（模型已被删除）显示「已删除的模型」，而不是把裸 id 甩给用户
// ——那串十六进制在界面上除了占地方没有任何意义。
func embeddingLabel(modelName, embdID string) string {
	if modelName != "" {
		return modelName
	}
	if embdID == "" {
		return ""
	}
	if idx := strings.Index(embdID, "@"); idx > 0 {
		return embdID[:idx]
	}
	if looksLikeHexID(embdID) {
		return "已删除的模型"
	}
	return embdID
}

// looksLikeHexID 判断字符串是不是 32 位小写十六进制（tenant_model.id 的形状）。
func looksLikeHexID(s string) bool {
	if len(s) != 32 {
		return false
	}
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// ListTenantResources 列出某个租户下的成员 / 知识库 / 智能体明细。
//
// 三种资源的字段不同，统一返回 {id, name, extra, cells}：
//   - name/extra 是列表里最显眼的一行（主标题 + 右侧摘要）；
//   - cells 是「一列一个值」的明细，前端按类型决定展示哪几列。
//
// 文本（角色 / 状态 / 时间）在这里就定好格式，前端只排版，不做二次判断。
func (s *Service) ListTenantResources(ctx context.Context, tenantID, resourceType string) ([]map[string]interface{}, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return nil, fmt.Errorf("tenant id is required")
	}

	// 确认租户存在，避免传错 id 时静默返回空列表
	var tenantCount int64
	if err := dao.DB.WithContext(ctx).Table("tenant").Where("id = ?", tenantID).Count(&tenantCount).Error; err != nil {
		return nil, err
	}
	if tenantCount == 0 {
		return nil, fmt.Errorf("tenant not found")
	}

	result := make([]map[string]interface{}, 0)

	switch resourceType {
	case "members":
		// 除了展示用的 name / extra，再给前端一列一列的明细（cells）。
		// 角色、状态、时间都在这里定好格式，前端只负责排版。
		type memberRow struct {
			ID            string
			Email         string
			Nickname      string
			Role          string
			UserStatus    string
			IsActive      string
			LastLoginTime *time.Time
			JoinedAt      *time.Time
		}
		var rows []memberRow
		if err := dao.DB.WithContext(ctx).Raw(`
			SELECT u.id,
			       u.email,
			       IFNULL(u.nickname, '') AS nickname,
			       ut.role,
			       IFNULL(u.status, '') AS user_status,
			       IFNULL(u.is_active, '') AS is_active,
			       u.last_login_time,
			       ut.create_date AS joined_at
			FROM user_tenant ut
			JOIN user u ON u.id = ut.user_id
			WHERE ut.tenant_id = ? AND ut.status = '1'
			ORDER BY (ut.role = 'owner') DESC, ut.create_date, u.email
		`, tenantID).Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, r := range rows {
			name := r.Nickname
			if name == "" {
				name = r.Email
			}
			result = append(result, map[string]interface{}{
				"id": r.ID, "name": name, "extra": r.Role,
				"cells": map[string]string{
					"email":      r.Email,
					"role":       r.Role,
					"status":     accountStatusLabel(r.UserStatus, r.IsActive),
					"last_login": formatOptionalTime(r.LastLoginTime, "2006-01-02 15:04"),
					"joined":     formatOptionalTime(r.JoinedAt, "2006-01-02"),
				},
			})
		}

	case "kbs":
		// 知识库能展示的字段最多，一次取齐，省得前端再补一轮请求：
		// 规模（文件/分块）、解析方式、向量模型、启用开关、创建人、时间。
		type kbRow struct {
			ID           string
			Name         string
			DocNum       int64
			ChunkNum     int64
			ParserID     string
			EmbdID       string
			CreatorName  string
			CreatorEmail string
			Enabled      int64
			CreateDate   *time.Time
			UpdateDate   *time.Time
		}
		var rows []kbRow
		if err := dao.DB.WithContext(ctx).Raw(`
			SELECT kb.id,
			       IFNULL(kb.name, '') AS name,
			       IFNULL(kb.doc_num, 0) AS doc_num,
			       IFNULL(kb.chunk_num, 0) AS chunk_num,
			       IFNULL(kb.parser_id, '') AS parser_id,
			       IFNULL(kb.embd_id, '') AS embd_id,
			       IFNULL(u.nickname, '') AS creator_name,
			       IFNULL(u.email, '') AS creator_email,
			       IFNULL(kb.enabled, 1) AS enabled,
			       kb.create_date,
			       kb.update_date
			FROM knowledgebase kb
			LEFT JOIN user u ON u.id = kb.created_by
			WHERE kb.tenant_id = ? AND kb.status = '1'
			ORDER BY kb.create_date DESC
		`, tenantID).Scan(&rows).Error; err != nil {
			return nil, err
		}

		// embd_id -> tenant_model.model_name。刻意单独查一次而不写进上面的
		// JOIN：模型目录是平台侧配置，缺表或缺行都只该让这一列退化成原始 id，
		// 不该把整个知识库列表拖成 500。
		embdIDs := make([]string, 0, len(rows))
		for _, r := range rows {
			if r.EmbdID != "" {
				embdIDs = append(embdIDs, r.EmbdID)
			}
		}
		modelNames := map[string]string{}
		if len(embdIDs) > 0 {
			type modelRow struct {
				ID        string
				ModelName string
			}
			var models []modelRow
			if err := dao.DB.WithContext(ctx).
				Table("tenant_model").
				Select("id, IFNULL(model_name, '') AS model_name").
				Where("id IN ?", embdIDs).
				Scan(&models).Error; err == nil {
				for _, m := range models {
					modelNames[m.ID] = m.ModelName
				}
			}
		}

		for _, r := range rows {
			creator := r.CreatorName
			if creator == "" {
				creator = r.CreatorEmail
			}
			result = append(result, map[string]interface{}{
				"id": r.ID, "name": r.Name,
				"extra": fmt.Sprintf("%d 个文件 · %d 个分块", r.DocNum, r.ChunkNum),
				"cells": map[string]string{
					"docs":      fmt.Sprintf("%d", r.DocNum),
					"chunks":    fmt.Sprintf("%d", r.ChunkNum),
					"parser":    parserLabel(r.ParserID),
					"embedding": embeddingLabel(modelNames[r.EmbdID], r.EmbdID),
					"status":    datasetEnabledLabel(r.Enabled),
					"creator":   creator,
					"created":   formatOptionalTime(r.CreateDate, "2006-01-02"),
					"updated":   formatOptionalTime(r.UpdateDate, "2006-01-02 15:04"),
				},
			})
		}

	case "agents":
		// user_canvas 没有 tenant_id 列（租户 id 就是 owner 的 user id），
		// 必须按 user_id 过滤，才和 ListTenants 里 agent_count 的口径一致。
		// 写成 tenant_id 会在 MySQL 报 Error 1054，整个明细弹窗 500。
		type agentRow struct {
			ID         string
			Title      string
			Category   string
			CreateDate *time.Time
		}
		var rows []agentRow
		if err := dao.DB.WithContext(ctx).Raw(`
			SELECT id,
			       IFNULL(title, '未命名') AS title,
			       IFNULL(canvas_category, '') AS category,
			       create_date
			FROM user_canvas
			WHERE user_id = ?
			ORDER BY create_date DESC
		`, tenantID).Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, r := range rows {
			category := canvasCategoryLabel(r.Category)
			result = append(result, map[string]interface{}{
				"id": r.ID, "name": r.Title,
				// 这张表同时放智能体 / 工作流 / 对话流 / 数据处理画布，
				// 上层的 agent_count 也是全量计数，列表必须标出类型，
				// 否则「智能体列表」里混进十几条工作流会让人以为统计错了。
				"extra": category,
				"cells": map[string]string{
					"category": category,
					"created":  formatOptionalTime(r.CreateDate, "2006-01-02"),
				},
			})
		}

	default:
		return nil, fmt.Errorf("unsupported resource type: %s", resourceType)
	}

	return result, nil
}

// SetTenantOwner 把指定用户设为该租户的超管（owner），原超管降级为普通成员。
//
// 用户与租户已解耦（创建用户不再自动建租户），所以目标用户可能：
//   - 已经在该租户里 → 直接改 role；
//   - 完全不在该租户 → 补一条 user_tenant(role=owner, join_type=direct)。
func (s *Service) SetTenantOwner(ctx context.Context, tenantID, userEmail string) (map[string]interface{}, error) {
	tenantID = strings.TrimSpace(tenantID)
	userEmail = strings.TrimSpace(userEmail)
	if tenantID == "" || userEmail == "" {
		return nil, fmt.Errorf("tenant id and user email are required")
	}

	var tenant entity.Tenant
	if err := dao.DB.WithContext(ctx).Where("id = ?", tenantID).First(&tenant).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("tenant not found")
		}
		return nil, err
	}

	var user entity.User
	if err := dao.DB.WithContext(ctx).Where("email = ?", userEmail).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("user not found: %s", userEmail)
		}
		return nil, err
	}

	err := dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&entity.UserTenant{}).
			Where("tenant_id = ? AND role = ?", tenantID, "owner").
			Update("role", "member").Error; err != nil {
			return err
		}

		var existing entity.UserTenant
		err := tx.Where("tenant_id = ? AND user_id = ?", tenantID, user.ID).First(&existing).Error
		if err == nil {
			return tx.Model(&entity.UserTenant{}).Where("id = ?", existing.ID).
				Updates(map[string]interface{}{"role": "owner", "status": "1"}).Error
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		memberStatus := "1"
		return tx.Create(&entity.UserTenant{
			ID:        common.GenerateUUID(),
			UserID:    user.ID,
			TenantID:  tenantID,
			Role:      "owner",
			InvitedBy: user.ID,
			Status:    &memberStatus,
			JoinType:  "direct",
		}).Error
	})
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"tenant_id":   tenantID,
		"owner_email": user.Email,
	}, nil
}
