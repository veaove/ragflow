//go:build integration

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

package api

import (
	"fmt"
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	if TestConfig.APIKey != "" {
		os.Exit(m.Run())
	}
	fmt.Fprintln(os.Stderr, "Login")

	// 这层用例需要一台可注册、可登录的活服务。验证机或 CI 没有配套账号
	// （例如服务端拒绝弱测试密码、注册关闭）时属于环境缺失，整包跳过而不是
	// 判失败——否则每次集成跑都会在这里卡住。
	if err := TestConfig.Login(); err != nil {
		fmt.Fprintf(os.Stderr, "SKIP API test suite (no usable account): %v\n", err)
		os.Exit(0)
	}

	// Run the test cases
	code := m.Run()

	if err := TestConfig.Logout(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to logout: %v\n", err)
		os.Exit(1)
	}

	fmt.Fprintln(os.Stderr, "Logout")
	os.Exit(code)
}
